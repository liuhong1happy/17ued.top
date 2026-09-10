要想在Kubernetes集群中部署使用GPU的模型预估应用，需要：

1. 集群中 Node 具备GPU硬件及驱动

2. 定制容器镜像，并挂载GPU驱动，以便业务应用调用GPU

3. 让调度器认识GPU硬件，方便将Pod调度到有GPU的Node上

4. 通过混布提升GPU利用率，需要进行GPU虚拟化

# GPU驱动程序

NVIDIA GPU 驱动程序的主要组成部分：

1. 内核模块：提供底层硬件访问和控制功能，加载到操作系统内核中

2. 用户空间库：包括 OpenGL、CUDA、OptiX 等库，用于开发和运行各种图形和计算应用

3. 用户空间工具：如 nvidia\-smi、nvidia\-cuda\-mps\-control，用于监控和管理 GPU 资源

# 定制容器镜像

利用NVIDIA GPU进行预估的应用一般都会用到 CUDA，容器内需要把 Node 上的相关 lib 挂到容器中，例如：

- libcuda

- libnvidia\-ml

- cuda\-lib64

# 让调度器认识GPU

在 Node上，kubelet 负责上报 Node 硬件详情，它能识别 cpu、mem、disk 等常见资源，但如何让它识别一些 k8s 默认没支持的特殊硬件资源呢，例如 FPGA、GPU？k8s 提供了 Device Plugins \(1\) 将扩展硬件的接口开放给了用户或者硬件供应商，将硬件信息注册给 kubelet，从而让调度器认识这种资源。

## DevicePlugin 向 kubelet 注册硬件

kubelet 对外提供了一个 Registration gRPC 服务。定义如下：

```ProtoBuf
service Registration {
        rpc Register(RegisterRequest) returns (Empty) {}
}
```

这是 K8S 提供扩展的常用方式（CRI、CSI、CNI 都是通过 gRPC 对外提供扩展能力），使用 RPC 服务来支持扩展，对k8s无侵入，且 plugin 不必和 kubelet 使用一样的编程语言，例如想资源占用更少或性能更好，可以选用 rust 或 c 实现。

Device Plugin 与 kubelet 通过 socket 通信来注册硬件资源，deviceplugin 以 DaemonSet 形式部署在集群中，每个有特殊硬件的node节点运行一个实例，deviceplugin会在节点上创建一个 socket 文件，一般是在 `/var/lib/kubelet/device-plugins/`，这也是 kubelet 自己的socket文件所在，kubelet 的 socket 路径一般是 `/var/lib/kubelet/device-plugins/kubelet.sock`，可以通过 `KubeletConfiguration` 来修改：

```YAML
kind: KubeletConfiguration
apiVersion: kubelet.config.k8s.io/v1beta1
healthzBindAddress: "0.0.0.0"
address: "0.0.0.0"
port: 10250
readOnlyPort: 10255
...
# 修改以下路径为新的 socket 路径
kubeletCgroups: "/new/socket/path"
```

deviceplugin 向 kubelet发送注册请求来注册自己，请求的内容参数如下：

> staging/src/k8s\.io/kubelet/pkg/apis/deviceplugin/v1alpha/api\.proto
> 
> 

```ProtoBuf
message RegisterRequest {
        string version = 1;
        // Name of the unix socket the device plugin is listening on
        // PATH = path.Join(DevicePluginPath, endpoint)
        string endpoint = 2;
        // Schedulable resource name. As of now it's expected to be a DNS Label
        string resource_name = 3;
}
```

接受参数中的字段包括：

- version：k8s plugin api 的版本，当前支持 v1alpha、v1beta1（2024/06）\(2\)

- endpoint：deviceplugin 的 socket

- resource\_name：自定义的资源名字，需要是一个合法的DNS Label（只包含小写字母、数字、\-）

注册完成后，kubelet 会通过 devicemanager来维护相关 deviceplugin，

> pkg/kubelet/cm/devicemanager/manager\.go \(3\)
> 
> 

```ProtoBuf
type ManagerImpl struct {
    // 保存设备插件的信息
    allDevices      map[string]map[string]pluginapi.Device
    unhealthyDevices map[string]map[string]pluginapi.Device
    // 保存 socket 与 device plugin 的对应关系，key是Resource名字
    endpoints map[string]endpointInfo
    // gRPC 服务器
    grpcServer     *grpc.Server
    // 注册 gRPC 服务器
    registrationServer *RegistrationServer
}
```

然后通过 list\-watch 来监听资源的变化，device plugin 会将状态变化推送给 kubelet。这里为什么不使用 kubelet 轮询呢？如果轮询，随着DevicePlugin变多，kubelet 性能会有退化，而且显然会有性能浪费，资源没有变化还在轮询，而 DevicePlugin 推送就可以避免这些问题。

## NVIDIA 的 Device Plugin

### 实现

NVIDIA 实现的device plugin 地址是 [https://github\.com/NVIDIA/k8s\-device\-plugin](https://github.com/NVIDIA/k8s-device-plugin) ，请求 Registration RPC 服务的定义：

> internal/plugin/server\.go
> 
> 

```Go
// Register registers the device plugin for the given resourceName with Kubelet.
func (plugin *NvidiaDevicePlugin) Register() error {
        conn, err := plugin.dial(pluginapi.KubeletSocket, 5*time.Second)
        if err != nil {
                return err
        }
        defer conn.Close()

        client := pluginapi.NewRegistrationClient(conn)
        reqt := &pluginapi.RegisterRequest{
                Version:      pluginapi.Version,
                Endpoint:     path.Base(plugin.socket),
                ResourceName: string(plugin.rm.Resource()),
                Options: &pluginapi.DevicePluginOptions{
                        GetPreferredAllocationAvailable: true,
                },
        }

        _, err = client.Register(context.Background(), reqt)
        if err != nil {
                return err
        }
        return nil
}
```

我们可以看到发送的 RegisterRequest 对象：

- Version，pluginapi\.Version 实际定义在 [kubelet源码中](https://github.com/kubernetes/kubernetes/blob/ccbe92982d839c4b558b91c6b2b64adcd3e079bf/staging/src/k8s.io/kubelet/pkg/apis/deviceplugin/v1beta1/constants.go#L26)，其值是 `Version = "v1beta1"`

- ResourceName, 也定义在代码库中 `const fullGPUResourceName = "nvidia.com/gpu"`，参见：internal/lm/resource\.go

### 部署

集群管理员可以通过 DaemonSet 的方式将其部署到各个 Node：

```YAML
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: nvidia-device-plugin-daemonset
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: nvidia-device-plugin-ds
  updateStrategy:
    type: RollingUpdate
  template:
    metadata:
      labels:
        name: nvidia-device-plugin-ds
    spec:
      tolerations:
      - key: nvidia.com/gpu
        operator: Exists
        effect: NoSchedule
      # Mark this pod as a critical add-on; when enabled, the critical add-on
      # scheduler reserves resources for critical add-on pods so that they can
      # be rescheduled after a failure.
      # See https://kubernetes.io/docs/tasks/administer-cluster/guaranteed-scheduling-critical-addon-pods/
      priorityClassName: "system-node-critical"
      containers:
      - image: nvcr.io/nvidia/k8s-device-plugin:v0.15.0
        name: nvidia-device-plugin-ctr
        env:
          - name: FAIL_ON_INIT_ERROR
            value: "false"
        securityContext:
          allowPrivilegeEscalation: false
          capabilities:
            drop: ["ALL"]
        volumeMounts:
        - name: device-plugin
          mountPath: /var/lib/kubelet/device-plugins
      volumes:
      - name: device-plugin
        hostPath:
          path: /var/lib/kubelet/device-plugins
```

device plugin 可以通过 RPC API 向 kubelet 注册该硬件，注册成功后，device plugin 就可以向 kubelet 发送它管理的设备列表，然后 kubelet 负责将这些资源发布到 kube\-apiserver，作为节点状态的一部分进行更新维护。

这时候，我们就可以在 Pod 里使用这个资源了，调度器可以识别，例如使用 `nvidia.com/gpu`：

```YAML
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  containers:
  - name: gpu-container
    image: nginx:1.25.5-alpine
    resources:
      limits:
        nvidia.com/gpu: 1
```

### device plugin 扩展资源类型的限制

经由 DevicePlugin 扩展出来的资源类型有一些限制：

- 扩展资源仅可以作为整数资源使用，不能超过limit

- 容器之间不能共享

这比较容易理解：

1. 许多硬件设备是物理设备，通常设计为单个进程独占，保证性能和安全。如果多个容器尝试同时访问同一个设备，可能会导致资源争用，性能下降甚至设备崩溃，从而导致应用性能下降或崩溃

2. 设备驱动，设备通常需要特定的驱动程序来访问和控制，这些驱动程序在设计时往往假设设备被单个用户或单个进程独占使用，多个进程同时访问可能会引发驱动程序的竞争条件和不一致行为

但资源精细化运营的今天，尤其是 GPU 这种紧俏资源，肯定要支持共享，有两种思路：

1. 用一个proxy，拦截cuda应用的allocate gpu mem/core的请求，并控制并发访问。这种思路有阿里云的 cGPU 方案，NVIDIA的 MPS 方案，当然 cGPU 实际在 MPS 的上游，也就是 如果使用了 MPS，cGPU 是访问的 MPS；

2. 借鉴 CPU 虚拟化的思路，将 GPU 虚拟化，让 device plugin 看到的是虚拟化切分后的 GPU，这样就可以让不同的容器用虚拟化后的 GPU，从而达到共享的目的，但资源利用率一般不如第一种。这种思路有NVIDIA 给最新的 A 系列提供了 MIG 方案，一种 GPU 虚拟化，硬隔离手段

# 进阶: GPU 虚拟化

随着 GPU 硬件的增强，有的 CUDA 应用能占满单个 GPU，有的不能，对于不能的，这样下来就会导致 GPU 的资源利用率不高，GPU 虚拟化允许多个虚拟机或 CUDA 应用容器共享一个物理GPU，从而提高资源利用率和灵活性。

GPU 虚拟化主要有四类：

1. 时间分片（Time Slicing）：通过时间片轮转的方式，将 GPU 时间分配给不同的虚拟机或容器。优点：实现简单，易于管理；缺点：可能导致延迟和性能不稳定

2. 空间分片（Space Slicing）：将 GPU 物理资源划分成多个独立的部分，每个部分分配给不同的虚拟机或容器。优点：可以提供稳定的性能和低延迟；缺点：资源利用率较低

3. MPS（Multi\-Process Service）：由 NVIDIA 提供的一个服务，允许多个 CUDA 进程共享一个 GPU。优点：可以提高 GPU 利用率和并发性能

4. vGPU（Virtual GPU）：由 NVIDIA 和 其它 GPU 厂商提供的解决方案，通过驱动程序和硬件支持，将 GPU 虚拟化成多个虚拟 GPU。优点：性能接近原生 GPU，支持广泛的应用和场景；缺点：需要专用硬件和软件支持

采用较多的方案有：

- cGPU（container GPU），属于时间分片和空间分片结合的方法

- NVIDIA MPS（Multi\-Process Service），主要属于时间分配的方案类别，但MPS 不同于传统的时间分片方法，传统的时间分片是单进程实现时间片轮转，而 MPS 允许多个独立的 CUDA 进程同时进行，通过一个中央的控制守护进程来管理和协调多个 CUDA 进程的执行，由于多个进程共享同一个 GPU，上下文切换的开销和内存使用可以显著降低，从而提高整体性能

- NVIDIA MIG（Multi\-Instance GPU），在 NVIDIA A30 / A100 等 GPU 上提供，允许将一个物理 GPU 划分为多个独立的 GPU 实例，每个实例有自己专属的计算资源和显存

## cGPU

cGPU\(4\) 核心思想是劫持 libcuda 实现 GPU 分时和分空间复用：

![cGPU 架构](/images/blog/k8s-gpu/image-1.png)

优点：物理GPU的资源任意划分。例如，GPU显存动态划分，支持M级划分、GPU利用率动态划分，算力支持最小2%粒度的划分；

缺点：随着依赖的升级，cgpu需要配合升级，维护的人力成本较高，例如 CUDA 版本升级、内核版本升级等都会影响 cgpu 是否可用。

## Multi\-Process Service\(MPS\)

![MPS 多进程服务](/images/blog/k8s-gpu/image-2.png)

MPS\(5\) 是单体 CUDA API 的兼容实现，设计用来透明地使多进程CUDA 程序（MPI jobs），透明意味着业务使用CUDA的应用程序不用修改，既可直接使用，支持MPS的GPU型号有 **A100、A30、A10、T4、V100**等。MPS 的组成部分 \(6\)：

1. 控制守护进程（Control Daemon Process）：负责启动和停止服务器，并协调客户端和服务器之间的连接

2. 客户端运行时（Client Runtime）：内置于CUDA 驱动程序中，这是可以透明地被CUDA 应用程序使用的关键

3. 服务器进程（Server Process）：客户端与GPU 之间的共享连接，提供客户端之间的并发性，确保多个客户端能同时高效地使用 GPU 资源

背景知识：

> MPI 作业是指使用消息传递接口（Message Passing Interface）编写和执行并行计算任务，MPI是一种广泛使用的标准，用于在分布式内存系统中实现并行计算，它允许多个进程通过消息传递进行通信和协作，从而共同完成计算任务。MPI作业通常运行在高性能计算集群上（HPC），每个进程可以在不同的计算节点上执行，以实现大规模的并行计算和数据处理。
> MPI 的思想和 Golang 的 CSP 理念有几分相像，都是通过通信进行更好的并发。不同的是 MPI 适合的是分布式系统，Go 的 CSP 适合单机，当然它们在实现细节上也有一些区别。
> 
> 

### 工作机制

MPS 通过在 GPU 上创建一个共享的进程上下文，让多个 CUDA 应用程序共享这个上下文来实现资源共享。具体来说，MPS 管理 GPU 上的多个进程，协调它们的资源请求，使它们能够有效地共享 GPU 资源。

MPS 运行在 GPU 驱动程序之上，依赖于驱动程序提供的 CUDA 支持和硬件访问功能。且 MPS 在设计时考虑了透明性和兼容性，原来的 CUDA 应用程序无需修改代码即可运行在 MPS 环境中：

1. CUDA 应用程序通过 CUDA API 与 GPU 通信，MPS 在底层实现了对这些 API 的支持；MPS 通过拦截和管理这些 API 调用，将多个进程的请求协调到一个 GPU 上，对于应用程序而言，使用 MPS 和直接访问 GPU 是一样的体验

2. 进程共享上下文：MPS 创建一个共享的 GPU 上下文，使多个进程能够共享同一个 GPU 资源。应用程序无需了解这个共享上下文的存在，它们的所有操作都被透明地路由到这个上下文中。MPS 通过管理这些上下文，实现了多进程并发访问 GPU 的能力，而不需要应用程序进行任何更改。

MPS 拦截CUDA API调用的原理：

1. Hooking CUDA API：
• MPS 在 NVIDIA 的 CUDA 驱动层面实现了钩子（hook），用于拦截和重定向 CUDA API 的调用。这些钩子函数能够捕捉到应用程序发出的 CUDA 函数调用。

2. CUDA Runtime Library：
• 应用程序使用的 CUDA API 函数通常包含在 CUDA 运行时库中。MPS 在运行时库中插入了自己的代码，以便截获和处理这些函数调用。

3. 共享 GPU 上下文：
• MPS 创建了一个共享的 GPU 上下文，多个 CUDA 进程可以共享这个上下文。在这个共享的上下文中，所有的 CUDA 操作都被透明地管理和调度。

4. 管理进程请求：
• 当多个进程同时请求 GPU 资源时，MPS 接收这些请求并根据一定的调度策略分配资源。这包括管理 GPU 的内存分配、核心资源的调度以及任务的执行顺序。

5. IPC 机制：
• MPS 使用 IPC（进程间通信）机制来协调和管理多个进程对 GPU 资源的访问。通过管道（pipe）或其他通信机制，不同进程可以向 MPS 发送请求并接收响应。

6. 调度策略：
• MPS 的实现还涉及到对进程请求的调度策略。这些策略可以根据应用程序的类型、优先级或其他因素来调整，以优化 GPU 资源的利用率和整体性能。

启动 MPS 控制守护进程： `nvidia-cuda-mps-control -d`

所以，我们可以看出，MPS 并不是一个纯粹的GPU 虚拟化方案，它是一个多进程共享GPU方案，用来编写MPI模式的并发程序，且进程间并不是完全相互隔离的，不提供错误隔离和内存保护，会导致GPU上运行的所有进程相互影响，更没有区分进程的算力用量监控能力。

更重要的是，从使用经验来看，MPS并不稳定，且其对业务来讲是黑盒，只能通过重启来解决故障\.

## Multi\-Instance GPU\(MIG\)

![MIG 多实例 GPU](/images/blog/k8s-gpu/image.png)

MIG\(7\) 与 MPS 不同，它提供真正的硬隔离，我们可以认为通过 MIG 可以把一个完整的物理GPU切成多个小GPU，每个MIG实例有自己的`计算核心(GPU core)`、显存、缓存、带宽，互不干扰。在不同的型号上支持的切卡数量不一样：

- A100 最多切成 7 个GPU实例

- A30 最多切成 4 个GPU实例

从上面描述也能看出，MIG比较适合：

- 云计算环境：提供细粒度的GPU实例给不同的用户或租户

- 多租户环境：确保不同用户的工作负载互不干扰，提高资源利用率

- 深度学习和高性能计算：在同一个物理GPU上运行多个独立的模型训练任务或计算任务

注意 MIG 和 vGPU 不一样，他们有不同的使用场景：

- MIG 更适用于高效利用单个物理 GPU 的场景，如数据中心中的资源共享和多租户环境下的 GPU 分配。它允许管理员根据需求划分和管理 GPU 资源，以最大化整体资源利用率。

- vGPU 则更适合于虚拟化环境中的图形加速和计算密集型应用程序，特别是在需要将多个虚拟机（VM）与单个 GPU 关联起来，并保证它们之间的隔离和性能的情况下。

# 进阶：GPU 联合

有的应用占不满单 GPU 卡，但有的却不够用，需要多卡联合才能满足其资源需求，例如现在的大模型，无论是训练还是预估，单卡都无法支撑，需要联合起来，通常的做法有几种：

- 数据并行：模型的副本被复制到每个GPU，并行处理不同数据批次。适合显存足够，算力不足的场景。实现方法包括：

    - 框架支持：TensorFlow、Pytorch、MXNet 都支持数据并行

    - 同步更新：每个GPU 上模型独立进行前向和后向计算，梯度在每个训练步骤结束后在所有 GPU 之间进行同步更新

    - 库和工具：可以使用 Horovod、Distributed Data Parallel（DDP）

- 模型并行：模型不同部分被分配到不同的 GPU，适用于模型大，显存不足的场景。实现方法包括：

    - 分片模型：将模型的不同层或模块分配到不同的 GPU，每个 GPU 只负责自己那部分的前向和后向传播

    - 框架支撑：TensorFlow 和 PyTorch 都支持，通过手动指定不同部分的计算设备实现

    - 流水线并行：将计算任务分割为多个阶段，每个阶段在不同 GPU 上顺序执行

- 混合并行：结合数据和模型并行，适合模型和数据集都大的情况

- 其它方法

    1. 梯度累计（Gradient Accumulation）：显存不足以一次性处理一个大批次的数据时，可以通过累积将多个小批次的梯度累计起来，模拟一个大批次的训练效果

    2. 分布式训练：利用分布式计算资源（如多机多卡）来分摊计算和存储需求，通过网络进行节点间通信和数据同步

    3. 图计算框架：使用如 Dask、Ray 等分布式框架来实现更加灵活的分布式训练策略

常用的框架也支持这些联合方案，例如 PyTorch 的 Parallelism API 支持 DDP、FSDP、TP、PP等多种方式支持多GPU分布式并行训练和预估。\(8\)

## 分布式环境下，网络通信是关键

数据读取和处理速度：显存 \> 内存 \> SSD，但容量上 SSD \> 内存/显存。所以可以在 SSD存储完整的模型文件（T级）和元数据，内存可以使用 LRU 在有限空间支持更多数据

CPU与GPU算力：GPU \> CPU

通信：单机卡与卡之间通信，多机通信

- RDMA多机通信：多机GPU可以通过网卡直接通信！性能提升

NVLink

NVSwitch

todo: 横向扩展问题

todo：

# 进阶：混布

混布包括在在线混布、在离线混布，需要注意相互之间的影响。

分时复用：如潮汐算力

## Footnotes

1. [https://kubernetes\.io/docs/concepts/extend\-kubernetes/compute\-storage\-net/device\-plugins/](https://kubernetes.io/docs/concepts/extend-kubernetes/compute-storage-net/device-plugins/) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-6-4dba1593f0449b441976f71d8e3500f9)

2. [https://github\.com/kubernetes/kubernetes/tree/ccbe92982d839c4b558b91c6b2b64adcd3e079bf/staging/src/k8s\.io/kubelet/pkg/apis/deviceplugin](https://github.com/kubernetes/kubernetes/tree/ccbe92982d839c4b558b91c6b2b64adcd3e079bf/staging/src/k8s.io/kubelet/pkg/apis/deviceplugin) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-4-4dba1593f0449b441976f71d8e3500f9)

3. [https://github\.com/kubernetes/kubernetes/blob/0c8b3e5f305bf2bf56d47019199b81330d90c2c3/pkg/kubelet/cm/devicemanager/manager\.go\#L57C6\-L57C17](https://github.com/kubernetes/kubernetes/blob/0c8b3e5f305bf2bf56d47019199b81330d90c2c3/pkg/kubelet/cm/devicemanager/manager.go#L57C6-L57C17) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-7-4dba1593f0449b441976f71d8e3500f9)

4. [https://www\.alibabacloud\.com/help/zh/egs/what\-is\-cgpu](https://www.alibabacloud.com/help/zh/egs/what-is-cgpu) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-1-4dba1593f0449b441976f71d8e3500f9)

5. [https://docs\.nvidia\.com/deploy/mps/index\.html](https://docs.nvidia.com/deploy/mps/index.html) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-2-4dba1593f0449b441976f71d8e3500f9)

6. [https://docs\.nvidia\.com/deploy/mps/index\.html\#what\-mps\-is](https://docs.nvidia.com/deploy/mps/index.html#what-mps-is) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-5-4dba1593f0449b441976f71d8e3500f9)

7. [https://www\.nvidia\.com/en\-us/technologies/multi\-instance\-gpu/](https://www.nvidia.com/en-us/technologies/multi-instance-gpu/) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-3-4dba1593f0449b441976f71d8e3500f9)

8. [https://pytorch\.org/tutorials/beginner/dist\_overview\.html\#parallelism\-apis](https://pytorch.org/tutorials/beginner/dist_overview.html#parallelism-apis) [↩](https://github.com/QingyaFan/blog/issues/53#user-content-fnref-8-4dba1593f0449b441976f71d8e3500f9)

