# **安装 Docker Engine**



```Bash
# 卸载旧系统docker
sudo apt-get remove docker docker-engine docker.io containerd runc
# 安装依赖包
sudo apt-get update
sudo apt-get install \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg-agent \
    software-properties-common

# 添加apt源 华为云上最好是华为云自己的源比较好
sudo mkdir -p /etc/apt/trusted.gpg.d
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/trusted.gpg.d/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/trusted.gpg.d/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 3. 获取华为云docker-ce源密钥
sudo rm -f /etc/apt/sources.list.d/docker.list
sudo rm -rf /etc/apt/keyrings/docker.gpg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://mirrors.huaweicloud.com/docker-ce/linux/ubuntu jammy stable" | sudo tee /etc/apt/sources.list.d/docker.list

# 安装最新版本
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
# 添加开机自启动
sudo systemctl start docker
sudo systemctl enable docker
# 验证 Docker 是否安装成功
sudo docker --version
sudo docker compose version
# 配置非root用户权限（可选）
sudo usermod -aG docker $USER
newgrp docker  # 立即生效（或重新登录）
```



# 安装golang

```Bash

# 下载golang编译（ubuntu24.04）
sudo apt update && sudo apt install -y make git
sudo wget https://mirrors.aliyun.com/golang/go1.26.4.linux-amd64.tar.gz
# 先删除旧版本（如有）
sudo rm -rf /usr/local/go 

# 解压至 /usr/bin
sudo tar -C /usr/bin -xzf go1.26.4.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/bin/go/bin' >> ~/.bashrc
echo 'export GOPATH=/home/neme/go' >> ~/.bashrc
echo 'export PATH=$PATH:$GOPATH/bin' >> ~/.bashrc
echo 'export GO111MODULE=on' >> ~/.bashrc
echo 'export GOPROXY=https://mirrors.huaweicloud.com/repository/goproxy/,direct' >> ~/.bashrc
echo 'export GONOSUMDB=*' >> ~/.bashrc
source ~/.bashrc
# 设置root环境 GOPROXY
sudo go env -w GOPROXY=https://mirrors.huaweicloud.com/repository/goproxy/,direct
sudo go env -w GOPROXY=https://goproxy.cn,direct

# sudo 可用 - 需要登录root账号
visudo
#修改以下行，加入/usr/local/go/bin/，用冒号隔开
Defaults    secure_path = /sbin:/bin:/usr/sbin:/usr/bin
#修改后
Defaults    secure_path = /usr/bin/go/bin/:/sbin:/bin:/usr/sbin:/usr/bin
```

# **安装 docker cri**

安装

```Bash
# 下载二进制 访问https://github.com/Mirantis/cri-dockerd/releases
wget https://github.com/Mirantis/cri-dockerd/releases/download/v0.3.22/cri-dockerd_0.3.22.3-0.ubuntu-jammy_amd64.deb

# 安装
sudo dpkg -i cri-dockerd_0.3.22.3-0.ubuntu-jammy_amd64.deb
# 启动
systemctl daemon-reload
systemctl enable --now cri-docker.socket

```

```Bash
# 手动安装
cd /var/opt
sudo git clone https://gitee.com/mirrors/cri-dockerd.git
cd cri-dockerd
sudo git checkout v0.4.3
sudo make cri-dockerd

# 编译后启动（ubuntu24.04）
sudo install -o root -g root -m 0755 cri-dockerd /usr/local/bin/cri-dockerd
sudo install packaging/systemd/* /etc/systemd/system
sudo sed -i -e 's,/usr/bin/cri-dockerd,/usr/local/bin/cri-dockerd,' /etc/systemd/system/cri-docker.service

```

配置

```Bash
# 配置
sudo vim /etc/systemd/system/cri-docker.service

# 修改如下
[Service]
Type=notify
ExecStart=/usr/bin/cri-dockerd --container-runtime-endpoint=unix:///var/run/cri-dockerd.sock --network-plugin=cni --pod-infra-container-image=registry.aliyuncs.com/google_containers/pause:3.10.1
ExecReload=/bin/kill -s HUP $MAINPID
TimeoutSec=0
RestartSec=2
Restart=always

# 重启 cri-docker.service
sudo systemctl daemon-reload
sudo systemctl enable cri-docker.service
sudo systemctl restart cri-docker.service

# 查看cri-docker.service 状态 ， 确保修改生效
sudo systemctl status cri-docker.service
```

# 禁用Swap

```Bash
# 1. 临时关闭 swap
sudo swapoff -a

# 2. 永久关闭 swap（重启服务器也不会生效）
sudo sed -i '/swap/s/^/#/' /etc/fstab

# 3. 重启 kubelet，立即恢复正常
sudo systemctl daemon-reload
sudo systemctl restart kubelet
```

# **安装 kubeadm kubelet kubectl**



```Bash
sudo apt-get update
# apt-transport-https 可能是一个虚拟包（dummy package）；如果是的话，你可以跳过安装这个包
sudo apt-get install -y apt-transport-https ca-certificates curl gpg

# 如果 `/etc/apt/keyrings` 目录不存在，则应在 curl 命令之前创建它，请阅读下面的注释。
# sudo mkdir -p -m 755 /etc/apt/keyrings
# curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.35/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
curl -fsSL https://mirrors.aliyun.com/kubernetes-new/core/stable/v1.35/deb/Release.key | sudo gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
# 此操作会覆盖 /etc/apt/sources.list.d/kubernetes.list 中现存的所有配置。
# echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.35/deb/ /' | sudo tee /etc/apt/sources.list.d/kubernetes.list
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://mirrors.aliyun.com/kubernetes-new/core/stable/v1.35/deb/ /" | sudo tee /etc/apt/sources.list.d/kubernetes.list

# 更新 apt 包索引，安装 kubelet、kubeadm 和 kubectl，并锁定其版本
sudo apt-get update
sudo apt-get install -y kubelet kubeadm kubectl
# (可选)
sudo apt-mark hold kubelet kubeadm kubectl
#（可选）先启用 kubelet 服务，再运行 kubeadm
sudo systemctl enable --now kubelet
# 注意需要提前禁用swap
sudo systemctl start kubelet
```



# **kubeadm常用命令**



```Bash
# 拉取所有依赖镜像
sudo kubeadm config images pull --cri-socket=unix:///var/run/cri-dockerd.sock --image-repository=registry.aliyuncs.com/google_containers
# 重置平面控制组件或者Node组件
sudo kubeadm reset --cri-socket=unix:///var/run/cri-dockerd.sock
# 初始化平面控制 192.168.1.225 更换为你的ip
sudo kubeadm init \
  --apiserver-advertise-address=192.168.1.225 \
  --control-plane-endpoint=192.168.1.225 \
  --pod-network-cidr=10.244.0.0/16 \
  --service-cidr=10.96.0.0/12 \
  --cri-socket=unix:///var/run/cri-dockerd.sock \
  --ignore-preflight-errors=Swap \
  --image-repository=registry.aliyuncs.com/google_containers
 # 生成token并打印join节点的命令
 kubeadm token create --print-join-command
 # 列举token
 kubeadm token list

 # 加入
 kubeadm join 192.168.0.65:6443 \
     --token qp5mud.8501mo4t9an09n42 \
     --discovery-token-ca-cert-hash sha256:10ea68e09f1a17daace738513c26dc4682b8b3352ed5bfc09a34834c1dc21c48 \
     --cri-socket=unix:///var/run/cri-dockerd.sock \
     --ignore-preflight-errors=Swap 
```



init成功后会提示如下：

```Plain Text
Your Kubernetes control-plane has initialized successfully!

To start using your cluster, you need to run the following as a regular user:

  mkdir -p $HOME/.kube
  sudo cp -i /etc/kubernetes/admin.conf $HOME/.kube/config
  sudo chown $(id -u):$(id -g) $HOME/.kube/config

Alternatively, if you are the root user, you can run:

  export KUBECONFIG=/etc/kubernetes/admin.conf

You should now deploy a pod network to the cluster.
Run "kubectl apply -f [podnetwork].yaml" with one of the options listed at:
  https://kubernetes.io/docs/concepts/cluster-administration/addons/

You can now join any number of control-plane nodes by copying certificate authorities
and service account keys on each node and then running the following as root:

  kubeadm join 192.168.1.225:6443 --token 3pivpu.2n7q00xoftsub4uu \
        --discovery-token-ca-cert-hash sha256:67da4bf77ecb865ad963a80dba62a8c73c697f27db64b83f49710cb343893cbe \
        --control-plane

Then you can join any number of worker nodes by running the following on each as root:

kubeadm join 192.168.1.225:6443 --token 3pivpu.2n7q00xoftsub4uu \
        --discovery-token-ca-cert-hash sha256:67da4bf77ecb865ad963a80dba62a8c73c697f27db64b83f49710cb343893cbe
```



# CNI 网络插件安装

```Bash
# Flannel VXLAN 模式强制依赖 内核模块 br_netfilter
sudo modprobe br_netfilter #  临时加载模块
echo "br_netfilter" | sudo tee /etc/modules-load.d/br_netfilter.conf # 永久启用（重启后依然生效）
lsmod | grep br_netfilter # 验证模块是否加载成功 输出 br_netfilter 即代表成功。

# flannel安装
wget https://github.com/flannel-io/flannel/releases/latest/download/kube-flannel.yml
kubectl apply -f kube-flannel.yml
# 查看状态
kubectl get pods -n kube-flannel
kubectl describe pod kube-flannel-ds-n7trj -n kube-flannel


```

# Headlamp \- UI控制面板

```Bash
# 创建sa
kubectl -n kube-system create serviceaccount headlamp-admin
kubectl create clusterrolebinding headlamp-admin --serviceaccount=kube-system:headlamp-admin --clusterrole=cluster-admin
kubectl get clusterrolebinding headlamp-admin
# 
wget https://raw.githubusercontent.com/kubernetes-sigs/headlamp/main/kubernetes-headlamp.yaml
kubectl apply -f kubernetes-headlamp.yaml
# 允许控制平面也执行调度
kubectl taint nodes --all node-role.kubernetes.io/control-plane-
# 如果要外网访问 需要修改Service的type为NodePort
# 查看状态
kubectl get pods -n kube-system | grep headlamp
kubectl describe pod headlamp-5b987d5657-ctdb7 -n kube-system
# 查看token
kubectl get secret headlamp-admin -n kube-system -o jsonpath='{.data.token}' | base64 -d && echo


# 查看访问地址
kubectl get svc headlamp -n kube-system
```

# IPVS安装

```Shell
# 更新软件包索引
sudo apt update  
# 安装 IPVS 管理工具 
ipvsadm
sudo apt install -y ipvsadm  
# 安装依赖工具（可选，用于自动加载内核模块）
sudo apt install -y linux-modules-extra-$(uname -r)
# 创建配置文件
sudo tee /etc/modules-load.d/ipvs.conf <<EOF 
ip_vs 
ip_vs_rr 
ip_vs_wrr 
ip_vs_sh 
nf_conntrack 
EOF
# 生效配置（可选，无需重启）
sudo systemctl restart systemd-modules-load.service
#设置 IPVS 转发模式
sudo tee -a /etc/sysctl.conf <<EOF 
net.ipv4.ip_forward = 1 
EOF
# 生效配置
sudo sysctl -p
```

# kube\-proxy 配置ipvs

```YAML
apiVersion: kubeproxy.config.k8s.io/v1alpha1
kind: KubeProxyConfiguration
clientConnection:
  kubeconfig: /var/lib/kube-proxy/kubeconfig.conf
mode: "ipvs"  # 核心：将模式改为 ipvs（默认是 iptables）
ipvs:
  scheduler: "rr"  # 可选调度算法
  strictARP: true  # 推荐开启，避免 ARP 冲突
  tcpFinTimeout: 0s
  tcpTimeout: 0s
  udpTimeout: 0s
```

```Bash
# 编辑kube-proxy配置
kubectl edit configmap kube-proxy -n kube-system
# 修改如kube-proxy.yaml

# 重启
kubectl delete pod -n kube-system -l k8s-app=kube-proxy
# 验证生效
kubectl logs -n kube-system -l k8s-app=kube-proxy | grep "Using ipvs Proxier"
# 查看IPVS规则
ipvsadm -Ln
```

# Helm安装

```Bash
sudo apt-get install curl gpg apt-transport-https --yes
curl -fsSL https://packages.buildkite.com/helm-linux/helm-debian/gpgkey | gpg --dearmor | sudo tee /usr/share/keyrings/helm.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/helm.gpg] https://packages.buildkite.com/helm-linux/helm-debian/any/ any main" | sudo tee /etc/apt/sources.list.d/helm-stable-debian.list
sudo apt-get update
sudo apt-get install helm
```

```Bash
wget https://mirrors.huaweicloud.com/helm/v4.1.4/helm-v4.1.4-linux-amd64.tar.gz && tar -xvf helm-v4.1.4-linux-amd64.tar.gz && sudo cp linux-amd64/helm /usr/local/bin/
```

# Metrics Server安装

```Bash
wget kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
kubectl apply -f components.yaml
# 如果k8s没有配置TLS情况，需要修改部署配置文件 components.yaml，添加 
- --kubelet-insecure-tls
# 验证
kubelet top nodes
kubelet top pods

```



# PostgreSQL安装

```YAML
apiVersion: v1
kind: Namespace
metadata:
  name: postgresql
  labels:
    app: postgresql

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: postgresql-pv
  namespace: postgresql
spec:
  capacity:
    storage: 20Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: postgresql-storage
  hostPath:
    path: /var/data/postgresql/data
    type: DirectoryOrCreate

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgresql-pvc
  namespace: postgresql
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: postgresql-storage

---
apiVersion: v1
kind: Secret
metadata:
  name: postgresql-secret
  namespace: postgresql
type: Opaque
data:
  # echo -n "gitea" | base64
  POSTGRES_DB: "Z2l0ZWE="
  # echo -n "boticz" | base64
  POSTGRES_USER: "Ym90aWN6"
  # echo -n "<your-password>" | base64
  POSTGRES_PASSWORD: "Ym90aWN6QDIwMjU="

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgresql-deployment
  namespace: postgresql
spec:
  replicas: 1  # PostgreSQL 单实例运行，集群需专用配置
  selector:
    matchLabels:
      app: postgresql
  strategy:
    type: Recreate  # 重建策略，保证数据存储安全
  template:
    metadata:
      labels:
        app: postgresql
    spec:
      nodeSelector:
        kubernetes.io/hostname: neme-01
      containers:
      - name: postgresql
        image: m.daocloud.io/docker.io/postgres:17
        imagePullPolicy: IfNotPresent
        envFrom:
        - secretRef:
            name: postgresql-secret
            optional: true
        ports:
        - containerPort: 5432  # PostgreSQL默认端口
          name: postgresql
        volumeMounts:
        - name: postgresql-storage
          mountPath: /var/lib/postgresql/data  # PostgreSQL默认数据目录
          subPath: postgres  # 子路径，避免目录权限问题（PostgreSQL特有）
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        # 就绪探针：检测容器是否可提供服务
        readinessProbe:
          tcpSocket:
            port: 5432
          initialDelaySeconds: 30  # 启动后延迟30秒开始检测
          periodSeconds: 10        # 每10秒检测一次
          timeoutSeconds: 5        # 检测超时时间5秒
          failureThreshold: 3      # 连续3次失败标记为未就绪
        # 存活探针：检测容器是否存活，异常则重启
        livenessProbe:
          tcpSocket:
            port: 5432
          initialDelaySeconds: 60  # 启动后延迟60秒开始检测（比就绪探针久，保证服务初始化完成）
          periodSeconds: 20        # 每20秒检测一次
          timeoutSeconds: 5        # 检测超时时间5秒
          failureThreshold: 3      # 连续3次失败重启容器
      volumes:
      - name: postgresql-storage
        persistentVolumeClaim:
          claimName: postgresql-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: postgresql-service
  namespace: postgresql
spec:
  selector:
    app: postgresql
  ports:
  - port: 5432
    targetPort: 5432
  type: ClusterIP
```

# Gitea安装

```YAML
apiVersion: v1
kind: Namespace
metadata:
  name: gitea
  labels:
    app: gitea
---
# Gitea PV（持久化存储）
apiVersion: v1
kind: PersistentVolume
metadata:
  name: gitea-pv
  namespace: gitea
  labels:
    app: gitea
spec:
  capacity:
    storage: 20Gi
  accessModes:
    - ReadWriteOnce  
  persistentVolumeReclaimPolicy: Retain 
  hostPath:
    path: /data/gitea/data  
    type: DirectoryOrCreate
---
# Gitea 持久化存储（仓库数据、配置）
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: gitea-data-pvc
  namespace: gitea
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
# Gitea 持久化存储（仓库数据、配置）
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: gitea-etc-pvc
  namespace: gitea
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 1Gi
---
# Gitea ConfigMap（数据库连接配置）
apiVersion: v1
kind: ConfigMap
metadata:
  name: gitea-config
  namespace: gitea
data:
  USER_UID: "1000"
  USER_GID: "1000"
  DB_TYPE: postgres
  DB_HOST: postgresql-service.postgresql.svc.cluster.local:5432
  DB_NAME: gitea
  DB_USER: boticz
  DB_PASSWD: <your-password>
---
# Gitea StatefulSet
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: gitea
  namespace: gitea
spec:
  serviceName: gitea
  replicas: 1
  selector:
    matchLabels:
      app: gitea
  template:
    metadata:
      labels:
        app: gitea
    spec:
      containers:
      - name: gitea
        image: m.daocloud.io/docker.io/gitea/gitea:latest-rootless
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 2222
          name: ssh
        volumeMounts:
        - name: gitea-data
          mountPath: /var/lib/gitea
        - name: gitea-data
          mountPath: /etc
        envFrom:
        - configMapRef:
            name: gitea-config
      volumes:
      - name: gitea-data
        persistentVolumeClaim:
          claimName: gitea-data-pvc
      - name: gitea-etc
        persistentVolumeClaim:
          claimName: gitea-etc-pvc 
---
# Gitea Service
apiVersion: v1
kind: Service
metadata:
  name: gitea
  namespace: gitea
spec:
  type: NodePort  # 集群外可访问
  selector:
    app: gitea
  ports:
  - name: http
    port: 3000
    targetPort: 3000
    nodePort: 30080
  - name: ssh
    port: 2222
    targetPort: 2222
    nodePort: 30022

```



# Gitea Actions

安装

```Bash
cd /var/opt
git clone https://gitea.com/gitea/runner gitea_runner
cd gitea_runner
sudo make build
sudo cp gitea-runner /usr/local/bin/
```

配置

```Bash
gitea-runner generate-config > /etc/act_runner/config.yaml
```

运行

```Bash
gitea-runner daemon
```

配置自启动

```Plain Text
[Unit]
Description=Gitea Actions Runner
Documentation=https://gitea.com/gitea/act_runner
After=network.target docker.service
Requires=docker.service

[Service]
User=act_runner
Group=act_runner
WorkingDirectory=/var/lib/act_runner
ExecStart=/usr/local/bin/gitea-runner daemon --config /etc/act_runner/config.yaml
ExecReload=/bin/kill -s HUP $MAINPID
Restart=always
RestartSec=10
TimeoutSec=0

[Install]
WantedBy=multi-user.target
```

```Bash
# 创建用户
sudo adduser \
  --system \
  --shell /bin/bash \
  --gecos 'Gitea Actions Runner' \
  --group \
  --disabled-password \
  --home /var/lib/act_runner \
  act_runner
 # docker 加入到 act_runner 用户组
 sudo usermod -aG docker act_runner
 # kubectl 可以正常使用
 sudo -u act_runner mkdir /var/lib/act_runner/.kube/
 cp /home/neme/.kube/config /var/lib/act_runner/.kube/
  
# 二进制文件：/usr/local/bin/act_runner
# 配置文件：/etc/act_runner/config.yaml
# 注册文件：/var/lib/act_runner/.runner
# 创建 /etc/systemd/system/act_runner.service

sudo -u act_runner -i /usr/local/bin/gitea-runner register \
  --instance "http://192.168.1.206:30180" \
  --token "<your-runner-token>"

# 重新加载 systemd 配置
sudo systemctl daemon-reload

# 设置开机自启并立即启动
sudo systemctl enable act_runner --now

# 查看日志
sudo journalctl -u act_runner -f
```

sudo gitea\-runner register \\
  \-\-instance "http://192\.168\.0\.65:30080" \\
  \-\-token "<your-runner-token>"



安装node

```Plain Text
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

# Traefik安装

```YAML
# 启用hostNetwork 暴露的80端口就可以主机访问
hostNetwork: true
service:
  enable: false
securityContext:
  capabilities:
    add: [NET_BIND_SERVICE]
  allowPrivilegeEscalation: true
  readOnlyRootFilesystem: false
  privileged: true
podSecurityContext:
  runAsNonRoot: false
  runAsGroup: 0
  runAsUser: 0
deployment:
  dnsPolicy: ClusterFirstWithHostNet
  nodeSelector:
    kubernetes.io/hostname: boticz225  # 固定匹配节点名 boticz225
# 配置网络端口和入口点
# 入口点是接收传入流量的网络监听器
ports:
  traefik:
    port: 8082
    hostPort: 8082
    exposedPort: 8082
  # 定义名为'web'的HTTP入口点
  web:
    port: 80
    targetPort: 80
    nodePort: 30000
    exposedPort: 80

  # 定义名为'websecure'的HTTPS入口点
  websecure:
    port: 443
    targetPort: 443
    nodePort: 30001
    exposedPort: 443

# 以安全模式启用仪表盘
api:
  dashboard: true
  insecure: false

ingressRoute:
  dashboard:
    enabled: true
    matchRule: Host(`dashboard.boticz.com`)
    entryPoints:
      - websecure
    middlewares:
      - name: dashboard-auth
      - name: plugindemo

# 为仪表盘安全创建基本身份验证中间件和密钥
extraObjects:
  - apiVersion: v1
    kind: Secret
    metadata:
      name: dashboard-auth-secret
    type: kubernetes.io/basic-auth
    stringData:
      username: admin
      password: "<your-password>"      # 替换为实际密码
  - apiVersion: traefik.io/v1alpha1
    kind: Middleware
    metadata:
      name: dashboard-auth
    spec:
      basicAuth:
        secret: dashboard-auth-secret
  - apiVersion: traefik.io/v1alpha1
    kind: Middleware
    metadata:
      name: plugindemo
    spec:
      plugin:
        plugindemo:
          headers:
            Foo: Bar


# 我们将改用网关API进行路由
ingressClass:
  enabled: false

# 启用网关API提供程序并禁用KubernetesIngress提供程序
# 提供程序用于告知Traefik在何处查找路由配置
providers:
  kubernetesIngress:
     enabled: true
  kubernetesGateway:
     enabled: true
  kubernetesCRD:
     enabled: true
     allowCrossNamespace: true

deployment:
  additionalVolumes:
    - name: plugin-storage
      persistentVolumeClaim:
        claimName: traefik-plugin-pvc


experimental:
  localPlugins:
    gateway:
      moduleName: github.com/boticz/gateway
      type: localPath
      volumeName: plugin-storage
      subPath: gateway
      mountPath: /plugins-local/src/github.com/boticz/gateway
    plugindemo:
      moduleName: github.com/traefik/plugindemo
      version: v0.2.2
      type: localPath
      volumeName: plugin-storage
      subPath: plugindemo
      mountPath: /plugins-local/src/github.com/traefik/plugindemo

## 网关监听器
gateway:
  listeners:
    web:           # 与入口点`web`匹配的HTTP监听器
      port: 80
      protocol: HTTP
      namespacePolicy:
        from: All

    websecure:         # 与入口点`websecure`匹配的HTTPS监听器
      port: 443
      protocol: HTTPS  # 在Traefik内部终止TLS连接
      namespacePolicy:
        from: All
      mode: Terminate
      certificateRefs:
        - kind: Secret
          name: local-selfsigned-tls  # 安装前创建的密钥
          group: ""

# 启用可观测性
logs:
  general:
    level: INFO
  # 启用访问日志，默认输出到Traefik的标准输出。
  # 访问日志文档（https://doc.traefik.io/traefik/observability/access-logs/）
  # 涵盖了日志的格式化、过滤和输出选项
  access:
    enabled: true

# 启用Prometheus指标功能
metrics:
  prometheus:
    enabled: true
```

```YAML
apiVersion: apps/v1
kind: Deployment
metadata:
  name: whoami
  namespace: traefik
spec:
  replicas: 2
  selector:
    matchLabels:
      app: whoami
  template:
    metadata:
      labels:
        app: whoami
    spec:
      containers:
        - name: whoami
          image: traefik/whoami
          ports:
            - containerPort: 80
---
apiVersion: v1
kind: Service
metadata:
  name: whoami
  namespace: traefik
spec:
  selector:
    app: whoami
  ports:
    - port: 80
```

```YAML
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: whoami
  namespace: traefik
spec:
  parentRefs:
    - name: traefik-gateway  # 启用网关API提供程序时，Traefik创建的网关名称
  hostnames:
    - "whoami.boticz.com"
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: whoami
          port: 80
```

```Bash
# 添加 Chart 仓库和命名空间
helm repo add traefik https://traefik.github.io/charts
helm repo update
kubectl create namespace traefik

# 创建本地自签名 TLS 密钥
# 1) 生成一份对 *.boticz.com 有效的自签名证书
openssl req -x509 -nodes -days 36500 -newkey rsa:2048 \
  -keyout tls.key -out tls.crt \
  -subj "/CN=*.boticz.com"

# 2) 在traefik命名空间中创建TLS密钥
kubectl create secret tls local-selfsigned-tls \
  --cert=tls.crt --key=tls.key \
  --namespace traefik

# 准备 Helm Chart 配置值
# 将Chart安装到'traefik'命名空间 
helm install traefik traefik/traefik \
--namespace traefik \   
--values values.yaml

# 卸载
helm uninstall traefik traefik/traefik -n traefik --ignore-not-found

# 部署woami应用
kubectl apply -f whoami.yaml
# 创建网关 API 的 HTTPRoute 来暴露该应用
kubectl apply -f whoami-route.yaml


# 重启traefik
helm upgrade traefik traefik/traefik -f values.yaml -n traefik  
kubectl rollout restart deployment traefik -n traefik

```

# NFS安装

```Bash
# 安装NFS
sudo apt update && sudo apt install -y nfs-kernel-server rpcbind
# 创建共享目录（建议放在大磁盘路径，如/data/nfs）
sudo mkdir -p /data/nfs/storage 
# 设置权限（nfs客户端默认用nobody用户，需开放读写执行）
sudo chmod -R 777 /data/nfs/storage 
sudo chown -R nobody:nogroup /data/nfs/storage

sudo vim /etc/exports
# 写入如下内容
/data/nfs/storage  *(rw,sync,no_root_squash,no_subtree_check)

# 生效配置
sudo exportfs -r
# 启动并开机自启NFS服务
sudo systemctl enable --now nfs-server 
# 验证NFS共享（输出共享目录信息即成功） 
showmount -e localhost
```

展示如下内容标识安装完成

```Bash
Export list for localhost: 
/data/nfs/storage *
```

# nfs\-subdir\-external\-provisioner安装

```YAML
nfs:
  server: 192.168.1.225
  path: /data/nfs/storage
storageClass:
  name: nfs-storage
  defaultClass: true
  reclaimPolicy: Delete
nodeSelector:
  kubernetes.io/hostname: boticz225
```

```Bash
# 添加helm repo
helm repo add nfs-subdir-external-provisioner https://kubernetes-sigs.github.io/nfs-subdir-external-provisioner/
# 安装
helm install nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner   -n kube-system -f values.yaml
# 卸载
helm uninstall nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner   -n kube-system
```

# nfs\-subdir\-external\-provisioner安装第二个NFS

参考：

https://github\.com/kubernetes\-sigs/nfs\-subdir\-external\-provisioner/tree/master/charts/nfs\-subdir\-external\-provisioner

```YAML
nfs:
  server: 192.168.0.97
  path: /var/opt/data/nfs/storage
storageClass:
  name: nfs-client-storage
  defaultClass: true
  reclaimPolicy: Delete
  provisionerName: k8s-sigs.io/neme4090-nfs-subdir-external-provisioner
nodeSelector:
  kubernetes.io/hostname: neme4090
```

```Bash
# 安装
helm install neme4090-nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner   -n kube-system -f values-neme4090.yaml
# 卸载
helm uninstall neme4090-nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner   -n kube-system
# 更新
helm upgrade neme4090-nfs-subdir-external-provisioner nfs-subdir-external-provisioner/nfs-subdir-external-provisioner   -n kube-system -f values-neme4090.yaml
```

# harbor安装

```YAML
expose:
  type: nodePort
  tls:
    auto:
      commonName: harbor.boticz.com

persistence:
  storageClass: nfs-harbor
  persistentVolumeClaim:
    registry:
      size: 10Gi
    jobservice:
      size: 1Gi
    database:
      size: 1Gi
    redis:
      size: 1Gi

fullnameOverride: harbor
harborAdminPassword: <your-password>

portal:
  nodeSelector:
    kubernetes.io/hostname: boticz225

core:
  nodeSelector:
    kubernetes.io/hostname: boticz225

jobservice:
  nodeSelector:
    kubernetes.io/hostname: boticz225

registry:
  nodeSelector:
    kubernetes.io/hostname: boticz225

chartmuseum:
  enabled: false

trivy:
  enabled: true
  nodeSelector:
    kubernetes.io/hostname: boticz225

database:
  type: internal
  internal:
    nodeSelector:
      kubernetes.io/hostname: boticz225
    password: "<your-password>"

redis:
  type: internal
  internal:
    nodeSelector:
      kubernetes.io/hostname: boticz225
```

```Bash
# 安装
helm install harbor harbor/harbor -n harbor -f values.yaml
# 卸载
helm uninstall harbor harbor/harbor -n harbor --ignore-not-found
```

# Docker 登录harbor镜像仓库并pull和push镜像

TODO: xxx

# 部署mysql

```YAML
apiVersion: v1
kind: PersistentVolume
metadata:
  name: mysql-pv   # pv的名称
  namespace: mysql  #pv所属命名空间
spec:
  capacity:
    storage: 20Gi   #pv提供的存储容量
  accessModes:
    - ReadWriteOnce  
  #访问模式：单节点访问 ReadWriteOnce  多节点只读 ReadOnlyMany 多节点读写 ReadWriteMany  
  persistentVolumeReclaimPolicy: Retain  
  #回收策略：保留 Retain 自动删除 Delete
  storageClassName: mysql-storage  #存储类 用于区分存储卷及匹配相同类名的生命
  hostPath:
    path: /var/data/mysql/data  #挂载的本地目录
    type: DirectoryOrCreate  #目录类型：若不存在则会自动创建

--- 
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mysql-pvc
  namespace: mysql
spec:
  accessModes:  #访问模式：单节点读写，要与pv兼容
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi  # 存储空间
  storageClassName: mysql-storage  #匹配的存储类名称

---
apiVersion: v1
kind: Secret
metadata:
  name: mysql-secret
  namespace: mysql
type: Opaque
stringData:
  user: "boticz"
  password: "<your-password>"
  root_password: "<your-password>"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mysql-deployment
  namespace: mysql
spec:
  replicas: 1  # MySQL 通常单实例运行，如果要做集群需要特殊配置
  selector:
    matchLabels:
      app: mysql  # 与 Service 的 selector 匹配
  strategy:
    type: Recreate  # 使用 Recreate 策略确保数据安全
  template:
    metadata:
      labels:
        app: mysql  # 与 Service 的 selector 匹配
    spec:
      nodeSelector:
        kubernetes.io/hostname: boticz227
      containers:
      - name: mysql
        image: mysql:8.0.42  # 可根据需要指定版本
        imagePullPolicy: IfNotPresent
        env:
        - name: MYSQL_DATABASE
          value: "boticz_db"  # 初始数据库，可按需修改
        - name: MYSQL_USER
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: user
        - name: MYSQL_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: password
        - name: MYSQL_ROOT_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mysql-secret
              key: root_password
        ports:
        - containerPort: 3306
          name: mysql
        volumeMounts:
        - name: mysql-storage
          mountPath: /var/lib/mysql  # MySQL 默认数据目录
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        readinessProbe:
          tcpSocket:
            port: 3306
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        livenessProbe:
          tcpSocket:
            port: 3306
          initialDelaySeconds: 60
          periodSeconds: 20
          timeoutSeconds: 5
          failureThreshold: 3
      volumes:
      - name: mysql-storage
        persistentVolumeClaim:
          claimName: mysql-pvc  # 注意：这里需要修改 PVC 的命名空间

---
apiVersion: v1
kind: Service
metadata:
  name: mysql-service
  namespace: mysql
spec:
  selector:
    app: mysql  # 匹配Deployment中Pod的标签
  ports:
  - port: 3306    # Service端口
    targetPort: 3306  # 映射到Pod的端口
  type: NodePort  # NodePort：集群外可通过节点IP（如192.168.1.227）+端口访问
```

# 部署redis

```YAML
apiVersion: v1
kind: Secret
metadata:
  name: redis-secret
  namespace: redis
type: Opaque
stringData:
  redis-password: ""

---

apiVersion: v1
kind: PersistentVolume
metadata:
  name: redis-pv
  namespace: redis
spec:
  capacity:
    storage: 20Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: redis-storage
  hostPath:
    path: /var/data/redis/data
    type: DirectoryOrCreate

---

apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: redis-pvc
  namespace: redis
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: redis-storage

---

apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis-deployment
  namespace: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  strategy:
    type: Recreate
  template:
    metadata:
      labels:
        app: redis
    spec:
      nodeSelector:
        kubernetes.io/hostname: boticz227
      containers:
      - name: redis
        image: redis:7.4-alpine
        imagePullPolicy: IfNotPresent
        command: ["redis-server"]
        args: ["--requirepass", "$(REDIS_PASSWORD)", "--appendonly", "yes"]
        env:
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: redis-secret
              key: redis-password
        ports:
        - containerPort: 6379
          name: redis
        volumeMounts:
        - name: redis-storage
          mountPath: /data
        resources:
          requests:
            memory: "256Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        readinessProbe:
          tcpSocket:
            port: 6379
          initialDelaySeconds: 5
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
        livenessProbe:
          tcpSocket:
            port: 6379
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
      volumes:
      - name: redis-storage
        persistentVolumeClaim:
          claimName: redis-pvc

---

apiVersion: v1
kind: Service
metadata:
  name: redis-service
  namespace: redis
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
  type: NodePort
```

# 部署glc

```YAML
apiVersion: v1
kind: Secret
metadata:
  name: glc-secret
  namespace: glc
type: Opaque
stringData:
  glc-api-key: "boticz"
  enabled: "true"
  max-body-size: "256KB"
  enable-body-log: "true"
  content-types: ""
  glc-save-days: "7"
  glc-username: "boticz"
  glc-password: "<your-password>" 

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: glc-pv
  namespace: glc
spec:
  capacity:
    storage: 10Gi
  accessModes:
    - ReadWriteOnce
  persistentVolumeReclaimPolicy: Retain
  storageClassName: glc-storage
  hostPath:
    path: /var/data/glc/data  # GLC日志存储路径
    type: DirectoryOrCreate

---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: glc-pvc
  namespace: glc
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: glc-storage

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: glc-deployment
  namespace: glc
  labels:
    app: glc
spec:
  replicas: 1  # 根据实际需求调整副本数
  selector:
    matchLabels:
      app: glc
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        app: glc
    spec:
      nodeSelector:
        kubernetes.io/hostname: boticz227
      containers:
      - name: glc
        image: glc:0.17.7
        imagePullPolicy: IfNotPresent
        env:
        - name: GLCApiKey
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: glc-api-key
        - name: Enabled
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: enabled
        - name: MaxBodySize
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: max-body-size
        - name: EnableBodyLog
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: enable-body-log
        - name: ContentTypes
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: content-types
        - name: GLC_SAVE_DAYS
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: glc-save-days
        - name: GLC_USERNAME
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: glc-username
        - name: GLC_PASSWORD
          valueFrom:
            secretKeyRef:
              name: glc-secret
              key: glc-password
        ports:
        - containerPort: 8080
          name: glc
          protocol: TCP
        
        # 挂载持久化存储
        volumeMounts:
        - name: glc-storage
          mountPath: /var/log/glc
        
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
        
        livenessProbe:
          tcpSocket:
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3

        readinessProbe:
          tcpSocket:
            port: 8080
          initialDelaySeconds: 10
          periodSeconds: 5
          timeoutSeconds: 3
          failureThreshold: 3
      
      volumes:
      - name: glc-storage
        persistentVolumeClaim:
          claimName: glc-pvc

---
apiVersion: v1
kind: Service
metadata:
  name: glc-service
  namespace: glc
spec:
  selector:
    app: glc
  ports:
  - port: 80
    targetPort: 8080
    protocol: TCP
    name: glc
  type: NodePort
```

# 部署casbin服务

```YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: casbin-config
  namespace: nemework
data:
  config.yaml: |
    Port: :5000
    MySQL:
      Host: mysql-service.mysql.svc.cluster.local
      Port: 3306
      DataBase: db-oauth
      Charset: utf8mb4
      User: boticz
      Password: <your-password>
    Casbin:
      AutoLoadDuration: 10
      Model: |
        [request_definition]
        r = sub, obj, act
        [policy_definition]
        p = sub, obj, act
        [role_definition]
        g = _ , _
        [policy_effect]
        e = some(where (p.eft == allow))
        [matchers]
        m = (g(r.sub, p.sub) || p.sub == "*" ) && keyMatch(r.obj , p.obj) && (r.act == p.act || p.act == "*")

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: casbin-service
  namespace: nemework
  labels:
    app: casbin-service
spec:
  replicas: 1
  selector:
    matchLabels:
      app: casbin-service
  template:
    metadata:
      labels:
        app: casbin-service
    spec:
      nodeSelector:
        kubernetes.io/hostname: boticz227
      containers:
      - name: casbin
        image: casbin-service:v1.0
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 5000
          name: grpc
          protocol: TCP
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          tcpSocket:
            port: 5000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          tcpSocket:
            port: 5000
          initialDelaySeconds: 10
          periodSeconds: 5
      volumes:
      - name: config
        configMap:
          name: casbin-config

---
apiVersion: v1
kind: Service
metadata:
  name: nemework-casbin
  namespace: nemework
  labels:
    app: casbin-service
spec:
  type: ClusterIP
  ports:
  - port: 5000
    targetPort: 5000
    protocol: TCP
    name: grpc
  selector:
    app: casbin-service
```

# 部署auth服务

```YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: auth-config
  namespace: nemework
data:
  config.yaml: |
    redis:
      host: redis-service.redis.svc.cluster.local
      port: "6379"
      auth: ""

    mysql:
      host: mysql-service.mysql.svc.cluster.local
      port: "3306"
      user: boticz
      password: <your-password>
      db_name: db-oauth

    oauth_server:
      port: ":9000"
      jwt:
        secret_key: "your-secret-key-at-least-32-chars"
        key_id: ""
        signed_method: "HS256"
      clients:
        - id: "admin"
          secret: "admin"
          domain: "http://admin-service.default.svc.cluster.local:9001"
        - id: "app"
          secret: "app"
          domain: "http://app-service.default.svc.cluster.local:9002"
        - id: "web"
          secret: "web"
          domain: "http://web-service.default.svc.cluster.local:9003"

    admin_server:
      port: ":9001"

    app_server:
      port: ":9002"

    all_server:
      port: ":9005"

    tencent_sms:
      secret_id: "<your-tencent-secret-id>"
      secret_key: "<your-tencent-secret-key>"
      app_id: "1400999104"
      sign_name: "子空间机器人"
      template_code: "2453571"
      expire_time: 300
      storage_key: "sms_code:"

    qr_token:
      prefix: "https://boticz.cn/qrToken/"
      tmp_token_sign_key: "scanQr"
      expire_time: 300
      storage_key: "qr_token:"

    login_policy:
      max_login_fail_times: 5
      login_fail_countdown: 120
      storage_key: "login_fail_times:"

    token:
      is_cache_to_redis: 1
      max_online_users: 10
      access_token_expire: 7200
      refresh_token_expire: 604800
      refresh_allow_sec: 86400

    casbin_service:
      addr: "casbin-service.casbin.svc.cluster.local:5000"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: auth-deployment
  namespace: nemework
  labels:
    app: auth
spec:
  replicas: 1
  selector:
    matchLabels:
      app: auth
  template:
    metadata:
      labels:
        app: auth
    spec:
      nodeSelector:
        kubernetes.io/hostname: boticz227
      containers:
      - name: auth
        image: auth-service:v1.0
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 9005
          name: http
          protocol: TCP
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          tcpSocket:
            port: 9005
          initialDelaySeconds: 60
          periodSeconds: 30
          timeoutSeconds: 5
        readinessProbe:
          tcpSocket:
            port: 9005
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 3
      volumes:
      - name: config
        configMap:
          name: auth-config

---
apiVersion: v1
kind: Service
metadata:
  name: nemework-auth
  namespace: nemework
  labels:
    app: auth
spec:
  type: NodePort
  ports:
  - port: 9005
    targetPort: 9005
    protocol: TCP
    name: http
  selector:
    app: auth
```

# traefik本地插件

plugin\.yaml 放在插件代码的根目录

```YAML
displayName: Gateway Plugin
type: middleware
iconPath: .assets/icon.png
import: github.com/boticz/gateway
summary: '[Gateway] Baticz Gateway'
version: v1.0.0

defaultConfig:
  authorizationHeader: "Authorization"
  tokenSignKey: "boticz"
  logCollect:
    glcApiUrl: "glc-service.glc.svc.cluster.local:80"
    glcApiKey: "boticz"
    enabled: "true"
    maxBodySize: 262144
    enableBodyLog: true
  whiteListPath:
    - "/user/login"
    - "/user/register"
    - "/user/logout"
    - "/auth/authorize"
    - "/auth/token"
    - "/auth/admin/user/register"
    - "/auth/admin/user/get_scan_qr"
    - "/auth/admin/user/check_scan_qr_status"
    - "/auth/admin/user/forget_password"
    - "/auth/app/user/register"
    - "/auth/app/user/send_sms_code"
    - "/auth/app/user/forget_password"
  anonymousPath:
    - "/swagger.*"
```

```Bash
# 1. 检查Traefik Pod状态
kubectl get pods -n traefik | grep traefik
# 2. 查看Traefik日志，确认gateway插件加载成功（无报错，有加载日志）
kubectl logs -f <你的traefik-pod名称> -n traefik | grep -i gateway
```

```YAML
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: gateway-plugin
  namespace: traefik
spec:
  plugin:
    gateway:
      authorizationHeader: "Authorization"
      tokenSignKey: "boticz"
      logCollect:
        glcApiUrl: "glc-service.glc.svc.cluster.local:80"
        glcApiKey: "boticz"
        enabled: "true"
        maxBodySize: 262144
        enableBodyLog: true
      whiteListPath:
        - "/user/login"
        - "/user/register"
        - "/user/logout"
        - "/auth/authorize"
        - "/auth/token"
        - "/auth/admin/user/register"
        - "/auth/admin/user/get_scan_qr"
        - "/auth/admin/user/check_scan_qr_status"
        - "/auth/admin/user/forget_password"
        - "/auth/app/user/register"
        - "/auth/app/user/send_sms_code"
        - "/auth/app/user/forget_password"
      anonymousPath:
        - "/swagger.*"
```

```Bash
# 创建中间件
kubectl apply -f middlewares.yaml -n traefik
# 验证中间件创建成功（状态为Ready）
kubectl get middleware traefik.io/v1alpha1 gateway-plugin -n traefik
```

# 安装Docker Registry

```Bash
# 安装Docker Registry
docker run -d -p 5000:5000 \
--restart always \
--name registry \
-v /data/docker/registry:/var/lib/registry \
m.daocloud.io/docker.io/registry:3

# 本地hosts更改
192.168.1.225    dev-registry.boticz.com
1.95.222.220    registry.boticz.com

# 配置
sudo vim /etc/docker/daemon.json
# 添加内容如下
{
    "insecure-registries": ["dev-registry.boticz.com:5000"]
}

# 配置docker本地用户可以访问
sudo usermod -aG docker $USER
# 重启docker
systemctl daemon-reload
systemctl restart docker

# 对容器镜像进行打tag
docker tag nginx:latest dev-registry.boticz.com:5000/nginx:latest
# 推送镜像到镜像库
docker push dev-registry.boticz.com:5000/nginx:latest
# 拉取镜像到本地
docker pull dev-registry.boticz.com:5000/nginx:latest
```



# 安装MinIO

```YAML
rootUser: broot
rootPassword: <your-password>
users:
- accessKey: boticz
  secretKey: <your-password>
  policy: consoleAdmin
replicas: 2
service:
  type: NodePort
  port: "9000"
  nodePort: 30009
consoleService:
  type: NodePort
  port: "9001"
  nodePort: 31009
persistence:
  enable: true
  storageClass: "nfs-client-storage"
```

```Bash
# 添加Helm Repo
helm repo add minio https://charts.min.io/
# 安装
helm install minio minio/minio -n minio -f values.yaml
# 更新
helm upgrade minio minio/minio -n minio -f values.yaml
# 卸载
helm uninstall minio minio/minio -n minio
```

# 部署system服务

```YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: system-config
  namespace: nemework
data:
  config.yaml: |
    mysql:
      host: mysql-service.mysql.svc.cluster.local
      port: "3306"
      user: boticz
      password: <your-password>
      db_name: db-oauth

    redis:
      host: redis-service.redis.svc.cluster.local
      port: "6379"
      auth: ""

    web_server:
      port: ":9003"

    all_server:
      port: ":9006"

    jwt:
      secret_key: "boticz"

    tenant_invitation:
      storage_key: "tenant_invitation:"
      expire_time: 86400
      invitation_base_url: "http://yaoqinglianjie.com"

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: system-deployment
  namespace: nemework
  labels:
    app: system
spec:
  replicas: 1
  selector:
    matchLabels:
      app: system
  template:
    metadata:
      labels:
        app: system
    spec:
      nodeSelector:
        kubernetes.io/hostname: boticz227
      containers:
      - name: system
        image: system-service:v1.0
        imagePullPolicy: IfNotPresent
        ports:
        - containerPort: 9006
          name: http
          protocol: TCP
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          tcpSocket:
            port: 9006
          initialDelaySeconds: 60
          periodSeconds: 30
          timeoutSeconds: 5
        readinessProbe:
          tcpSocket:
            port: 9006
          initialDelaySeconds: 30
          periodSeconds: 10
          timeoutSeconds: 3
      volumes:
      - name: config
        configMap:
          name: system-config

---
apiVersion: v1
kind: Service
metadata:
  name: nemework-system
  namespace: nemework
  labels:
    app: system
spec:
  type: NodePort
  ports:
  - port: 9006
    targetPort: 9006
    protocol: TCP
    name: http
  selector:
    app: system

```

# Nvidia GPU支持

## 安装 Nvidia Driver

```Bash
sudo apt install nvidia-driver-550 -y
```

## 安装 nvidia\-container\-toolkit

```Bash
# install the prerequisites for the instructions below:
sudo apt-get update && sudo apt-get install -y --no-install-recommends \
   curl \
   gnupg2
 
#（修改）Configure the production repository:
# 1.加key
curl -fsSL https://mirrors.ustc.edu.cn/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg

# 2.生成list
curl -s -L https://mirrors.ustc.edu.cn/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://nvidia.github.io#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://mirrors.ustc.edu.cn#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
  
# Update the packages list from the repository:
sudo apt-get update

# Install the NVIDIA Container Toolkit packages:
export NVIDIA_CONTAINER_TOOLKIT_VERSION=1.18.2-1
  sudo apt-get install -y \
      nvidia-container-toolkit=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
      nvidia-container-toolkit-base=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
      libnvidia-container-tools=${NVIDIA_CONTAINER_TOOLKIT_VERSION} \
      libnvidia-container1=${NVIDIA_CONTAINER_TOOLKIT_VERSION}
```

## 安装 nvidia\-container\-runtime

```Bash
sudo apt-get install -y nvidia-container-runtime
```

## 安装 nvidia\-device\-plugin

```YAML
version: v1
sharing:
  timeSlicing:
    resources:
    - name: nvidia.com/gpu
      replicas: 10
flags:
    migStrategy: "none"
    failOnInitError: true
    nvidiaDriverRoot: "/"
    plugin:
      passDeviceSpecs: false
      deviceListStrategy: envvar
      deviceIDStrategy: uuid
```

```Bash
# 添加标签
kubectl label nodes ${node} nvidia.com/gpu.present=true
# 添加repo
helm repo add nvdp https://nvidia.github.io/k8s-device-plugin
helm repo update
# search
helm search repo nvdp --devel
# install
kubectl create ns nvidia-device-plugin
kubectl create cm -n nvidia-device-plugin nvidia-plugin-configs \
  --from-file=config=/var/opt/data/nvidia-device-plugin/dp-config.yaml

helm upgrade -i nvdp nvdp/nvidia-device-plugin \
  --namespace nvidia-device-plugin \
  --create-namespace \
  --set config.name=nvidia-plugin-configs \
  --version 0.19.3
  
```



```Bash
# 测试用
kubectl create -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.17.1/deployments/static/nvidia-device-plugin.yml
```

## 配置docker

```JSON
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io"
  ],
  "insecure-registries": ["dev-registry.boticz.com:5000"],
  "default-runtime": "nvidia",
  "runtimes": {
    "nvidia": {
      "args": [],
      "path": "/usr/bin/nvidia-container-runtime"
    }
  }
}
```

配置后重启docker

```Bash
systemctl daemon-reload
systemctl restart docker
```

## 验证GPU时间分片生效数量

```Plain Text
kubectl describe node neme | grep -A2 nvidia.com/gpu
```

## 测试是否安装成功

```YAML
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Pod
metadata:
  name: gpu-pod
spec:
  restartPolicy: Never
  containers:
    - name: cuda-container
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda12.5.0
      resources:
        limits:
          nvidia.com/gpu: 1 # requesting 1 GPU
  tolerations:
  - key: nvidia.com/gpu
    operator: Exists
    effect: NoSchedule
EOF
```

```Bash
$ kubectl logs gpu-pod
[Vector addition of 50000 elements]
Copy input data from the host memory to the CUDA device
CUDA kernel launch with 196 blocks of 256 threads
Copy output data from the CUDA device to the host memory
Test PASSED
Done
```



