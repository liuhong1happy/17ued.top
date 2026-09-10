
# 用户资料

## 资料下载

下载链接: [https://pan\.baidu\.com/s/1dTtxvSdqokB33xerBw3YBw](https://pan.baidu.com/s/1dTtxvSdqokB33xerBw3YBw) 提取码: y582
发布日期：20260105

## 目录结构

```Plain Text
K3588-C&OK3588-C21_Forlinx_Desktop22.04_用户资料_R5/
├── 0-使用前必读/                          # 使用前必读
│   ├── 0-飞凌软件用户资料内容索引.pdf
│   ├── 1-OK3588-C&OK3588-C21_Forlinx_Desktop22.04_软件资料更新记录_2026.01.05.pdf
│   ├── 2-技术与支持.pdf
│   └── 3-核心板出厂系统版本说明-PD20260323.pdf
│
├── 1-手册/                                # 手册
│   ├── 0-OK3588-C&OK3588-C21_产品使用手册.pdf
│   ├── 1-OK3588-C&OK3588-C21_Forlinx_Desktop22.04_模块支持列表_20260623.xlsx
│   ├── 2-FET3588_引脚复用对照表_20241202.xlsx
│   └── 3-FET3588_引脚功能对照表20250702.xlsx
│
├── 2-镜像及源码/                           # 镜像及源码
│   ├── 0-镜像/                             # 固件镜像
│   │   ├── update.img                      # 系统固件镜像 (Rockchip格式)
│   │   ├── md5.txt                         # 镜像MD5校验值
│   │   └── readme .txt                     # 镜像版本说明
│   │
│   └── 1-源码/                             # 源码包（分段压缩）
│       ├── OK3588-linux-source.tar.bz2.00  # 需要 cat *.tar.bz2.* | tar -xjf - 合并解压
│       ├── OK3588-linux-source.tar.bz2.01
│       ├── OK3588-linux-source.tar.bz2.02
│       ├── OK3588-linux-source.tar.bz2.03
│       ├── OK3588-linux-source.tar.bz2.04
│       └── md5.txt
│
├── 3-工具/                                # Windows工具集
│   ├── RKDevTool_v3.28_for_window.rar      # 刷机工具 (主用)
│   ├── DriverAssitant_v5.1.1.zip           # Rockchip USB 驱动
│   ├── FactoryTool-1.72.9.7z               # 量产烧录工具
│   ├── SDDiskTool_v1.69.zip                # SD卡固件制作工具
│   ├── FileZilla_3.24.0.0_win64-setup.exe  # FTP客户端
│   ├── FileZilla_3.31.0_win32-setup_bundled.exe
│   ├── CP210x_VCP_Windows_XP_Vista.zip     # 串口驱动
│   ├── TV_Camera_demo_protocol_V1.2.0.zip  # 摄像头测试工具
│   ├── YUV Player.exe                      # YUV播放器
│   ├── Win64OpenSSL-3_0_7.exe
│   ├── Win64OpenSSL_Light-3_0_7.exe
│   └── ToolsRelease.txt
│
├── 4-原厂资料/                             # Rockchip 原厂资料
│   ├── Rockchip RK3588 Datasheet V1.1-20220124.pdf    # 数据手册 V1.1
│   ├── Rockchip RK3588 Datasheet V1.7-20231117.pdf    # 数据手册 V1.7（最新）
│   ├── Rockchip RK3588 TRM V1.0-Part1-20220309.pdf    # 技术参考手册 Part1
│   ├── Rockchip RK3588 TRM V1.0-Part2 20220309.pdf    # 技术参考手册 Part2
│   └── Rockchip_RK3588_EVB_User_Guide_V1.0_CN.pdf     # EVB用户指南
```

# **环境信息**

- **主机**: Ubuntu 22\.04 x86\_64

- **内核版本**: Linux 5\.10 \(RK3588 SDK\)

- **目标系统**: Ubuntu 22\.04 \(jammy\) arm64

- **芯片**: Rockchip RK3588 \(OK3588\-C\)

- **工作目录**: \`/home/neme/OK3588\-linux\-source/\`

# 编译环境搭建与构建说明

## **1\. 解压源码**



源码位于用户资料的 `2-镜像及源码/1-源码/` 目录下，分为 5 个分段：

```Bash
cd "2-镜像及源码/1-源码/"
cat OK3588-linux-source.tar.bz2.* | tar -xjf - -C /home/neme/
```

> 解压后约 25 GB，239,000\+ 文件。
> 
> 

## **2\. 安装编译依赖**

以下为完整的依赖安装命令，避免逐轮试错：

```Bash
# 更新源
sudo apt-get update

# 必备工具包
sudo apt-get install -y openssh-server vim git fakeroot

# 编译工具链与依赖
sudo apt-get install -y repo git ssh make gcc libssl-dev liblz4-tool \
    expect g++ patchelf chrpath gawk texinfo diffstat binfmt-support \
    qemu-user-static live-build bison flex cmake gcc-multilib \
    g++-multilib unzip device-tree-compiler python-pip libncurses5-dev

# 构建基础工具
sudo apt-get install -y expect time build-essential kmod python3.9

# 文本界面库（menuconfig 等）
sudo apt-get install -y libncurses*

# 网络配置工具
sudo apt-get install -y net-tools

# sudo 免密码（构建过程中需要 mount/umount）
echo "$USER ALL=(ALL) NOPASSWD: ALL" | sudo tee /etc/sudoers.d/$USER
sudo chmod 440 /etc/sudoers.d/$USER
```

> **注意：** Ubuntu 22\.04\+ 若 \`python3\.9\` 不可用，安装 \`python3\` 替代。\`python\-pip\` 在新版本中为 \`python3\-pip\`。
> 
> 

## **3\. 配置和编译**

### **选择 defconfig**

```Bash
cd /home/neme/OK3588-linux-source/
./build.sh defconfig:OK3588_C_ubuntu22_defconfig
```

> 可用 defconfig: `OK3588_C_buildroot_defconfig`、`OK3588_C_ubuntu22_defconfig`
> 
> 

### **完整编译**

```Bash
cd /home/neme/OK3588-linux-source/
./build.sh all
```

> 编译时间约 30\-60 分钟（取决于 CPU），使用预置工具链 `prebuilts/gcc/linux-x86/aarch64/gcc-arm-10.3-2021.07-x86_64-aarch64-none-linux-gnu/` 交叉编译。
> 
> 

### **编译日志**

每次构建日志保存在：

```Plain Text
output/sessions/<日期_时间>/
output/log/ -> output/sessions/latest/
```

## **4\. 编译产物**

编译完成后所有镜像集中在 `rockdev/` 目录：

```Plain Text
rockdev/
├── update.img              # 完整刷机镜像 (7.6 GB)
├── rootfs.img              # Ubuntu 22.04 根文件系统 (7.1 GB)
├── userdata.img            # 用户数据分区 (331 MB)
├── recovery.img            # Recovery 恢复系统 (41 MB)
├── boot.img                # 内核 + DTB 启动镜像 (35 MB)
├── uboot.img               # U-Boot (4.0 MB)
├── MiniLoaderAll.bin        # SPL Loader (481 KB)
├── oem.img                 # OEM 分区 (18 MB)
├── misc.img                # 杂项配置 (48 KB)
└── parameter.txt           # 分区表 (539 B)
```

实际文件位置：`output/` 目录下各子目录，`rockdev/` 下为符号链接。

## **5\. 烧写固件**

使用 Windows 工具 `RKDevTool_v3.28` 烧写 `update.img`：

1. 开发板进入 Loader/MaskRom 模式

2. 连接 USB 到 Windows 电脑

3. RKDevTool → "升级固件" → 选择 `update.img` → "升级"

工具位于用户资料 `3-工具/`目录下：

- `RKDevTool_v3.28_for_window.rar` — 烧写工具

- `DriverAssitant_v5.1.1.zip` — USB 驱动

## **6\. 构建流程说明**

### **关键目录结构**

```Plain Text
OK3588-linux-source/
├── kernel/                 # Linux 5.10 内核
│   └── arch/arm64/boot/dts/rockchip/OK3588-C-linux.dts
├── u-boot/                 # U-Boot 引导加载器
├── ubuntu/                 # Ubuntu rootfs 镜像
├── device/forlinx/         # Forlinx 设备配置
│   └── .chip/ -> .chips/ok3588/
│       └── OK3588_C_ubuntu22_defconfig
├── prebuilts/gcc/linux-x86/aarch64/  # 预置交叉编译工具链
├── build.sh                # 主构建脚本
└── output/                 # 构建输出
```

### **构建阶段**

`./build.sh all` 按序执行：

1. **misc** — 空白 misc 镜像

2. **loader** — U\-Boot \(使用 prebuilts GCC 10\.3\)

3. **kernel** — Linux 内核 \(使用内核 defconfig \`OK3588\-C\-linux\_defconfig\`\)

4. **rootfs \(ubuntu\)** — Ubuntu jammy arm64 根文件系统

5. **wifi/bt** — NXP WiFi 驱动模块 \(mlan\.ko, moal\.ko\)

6. **recovery** — Recovery 恢复系统

7. **firmware** — 打包所有镜像为 `update.img`

## **7\. build\.sh 指令对照表**

### **配置类**

|命令|说明|
|---|---|
|`defconfig:<name>`|选择 SDK defconfig|
|`olddefconfig`|用默认值填充 \.config 中新增选项|
|`savedefconfig`|保存当前配置为最小 defconfig|
|`menuconfig`|交互式 curses 配置界面|
|`config`|修改 SDK defconfig|
|`kernel-config` / `kconfig`|修改内核 defconfig（如 `kmake:menuconfig`）|

### **独立编译（可加\`:dry\-run\` 仅预览不执行）**

|命令|说明|
|---|---|
|`all`|**全量编译**（默认） — misc → loader → kernel → rootfs → recovery → firmware → updateimg|
|`kernel`|编译内核 Image \+ DTB|
|`modules`|编译内核模块 \.ko \+ `sudo mount` rootfs 安装模块|
|`linux-headers`|打包 linux\-headers \.deb|
|`loader` / `uboot` / `u-boot`|编译 U\-Boot \+ SPL Loader|
|`rootfs` / `ubuntu`|构建 Ubuntu rootfs（其他：`buildroot` / `debian` / `yocto`）|
|`recovery`|构建 Recovery 恢复系统|
|`wifibt`|编译 WiFi/BT 驱动模块|
|`misc`|生成空白 misc 镜像|
|`amp`|构建 AMP 异构系统|
|`extra-parts`|打包额外分区（oem, userdata）|
|`firmware`|打包并校验所有固件|
|`updateimg`|生成最终 `update.img`|
|`ota-updateimg`|生成 OTA 升级包|

### **分区操作**

|命令|说明|
|---|---|
|`print-parts` / `list-parts`|打印当前分区表|
|`mod-parts`|交互式修改分区表|
|`edit-parts`|编辑原始分区文件|
|`new-parts:<offset>:<name>:<size>...`|重建分区表|
|`insert-part` / `del-part` / `move-part` / `rename-part` / `resize-part`|分区增删改查|

### **内核手工操作**

|命令|说明|
|---|---|
|`kernel-make:<args>` / `kmake:<args>`|透传参数给内核 make（如 `kmake:menuconfig`、`kmake:dtbs`）|

### **清理类**

|命令|说明|
|---|---|
|`cleanall`|清理全部构建产物|
|`clean:<模块>`|清理指定模块：`kernel` / `loader` / `rootfs` / `recovery` / `firmware` / `updateimg` / `misc` / `config` / `all`|

### **其他**

|命令|说明|
|---|---|
|`shell`|进入带 SDK 环境变量的开发 shell|
|`release`|发布镜像及构建信息到 `rockdev/`|
|`all-release`|构建 \+ 发布一步完成|
|`post-rootfs <dir>`|对已有 rootfs 目录执行 post 钩子脚本|
|`security-*`|安全启动相关（`createkeys` / `misc` / `ramboot` / `system`）|
|`115200` / `1500000`|修改 U\-Boot \+ 内核串口波特率|
|`help`|显示此帮助|

## **8\. 常用命令**

### **日常开发**

```Bash
# 首次编译
./build.sh defconfig:OK3588_C_ubuntu22_defconfig
./build.sh all

# 修改内核代码后，只重编内核
./build.sh kernel

# 修改内核配置
./build.sh kernel-config    # 或 ./build.sh kmake:menuconfig
./build.sh kernel

# 修改设备树后重编
./build.sh kernel           # DTB 随 kernel 一起生成

# 修改模块代码后
./build.sh modules          # 编译 + 自动挂载 rootfs 安装

# 修改 rootfs 内容后重新打包
./build.sh rootfs
./build.sh firmware
./build.sh updateimg
```

### **增量构建**

```Bash
# 仅重新生成 update.img（前提：各镜像已编译好）
./build.sh updateimg

# 只重编 U-Boot
./build.sh loader

# 清理后重编某个模块
./build.sh clean:kernel && ./build.sh kernel
```

### **调试**

```Bash
# 预览会执行的命令但不实际运行
./build.sh kernel:dry-run
./build.sh modules:dry-run

# 查看当前分区表
./build.sh list-parts

# 查看完整构建配置
cat output/.config | grep ^RK_
```

### **清理**

```Bash
# 完全清理重来
./build.sh cleanall
./build.sh defconfig:OK3588_C_ubuntu22_defconfig
./build.sh all

# 只清理内核
./build.sh clean:kernel
```

### **其他系统类型**

```Bash
# Buildroot 系统
./build.sh defconfig:OK3588_C_buildroot_defconfig
./build.sh all
```

## **9\. 应用程序构建**

SDK 附带的应用源码位于 \`app/\` 目录，需要**交叉编译**后在开发板上运行。

### **交叉编译工具链**

SDK 预置了 ARM64 交叉编译器：

```Bash
# 工具链路径
TC_DIR="prebuilts/gcc/linux-x86/aarch64/gcc-arm-10.3-2021.07-x86_64-aarch64-none-linux-gnu"
export PATH="$PWD/$TC_DIR/bin:$PATH"

# 验证
aarch64-none-linux-gnu-gcc --version
```

> 环境变量 `CROSS_COMPILE=aarch64-none-linux-gnu-`，`ARCH=arm64`。
> 
> 

### **应用目录结构**

```Plain Text
app/
├── forlinx/
│   ├── forlinx_cmd/         # C 命令行测试工具（Makefile 构建）
│   ├── forlinx_qt/          # Qt5 应用（Buildroot 版，qmake 构建）
│   ├── forlinx_ubuntu_qt/   # Qt5 应用（Ubuntu 版，qmake 构建）
│   └── quectelCM/           # 移远 4G 模块连接管理器
├── lvgl_demo/               # LVGL GUI 示例（CMake 构建）
├── rkadk/                   # Rockchip 应用开发框架（CMake 构建）
└── test_scripts/            # Shell 测试脚本（直接拷贝到开发板）
```

### **Makefile 类应用构建（forlinx\_cmd / quectelCM）**

```Bash
# 1. 设置交叉编译器
export CROSS_COMPILE=aarch64-none-linux-gnu-
export ARCH=arm64
export PATH="$PWD/prebuilts/gcc/linux-x86/aarch64/gcc-arm-10.3-2021.07-x86_64-aarch64-none-linux-gnu/bin:$PATH"

# 2. 构建 forlinx_cmd（SPI、UART、看门狗等测试工具）
cd app/forlinx/forlinx_cmd
make -j$(nproc)
# 产物在各子目录下，详见下方「固化到 rootfs」章节

# 3. 构建 quectelCM（4G 拨号管理）
cd app/forlinx/quectelCM
make release
# 产物：quectelCM, quectel-qmi-proxy, quectel-mbim-proxy
# 详见下方「固化到 rootfs」章节
```

### **CMake 类应用构建（lvgl\_demo / rkadk）**

```Bash
# lvgl_demo — 需指定 sysroot 为 Ubuntu rootfs 路径
cd app/lvgl_demo
mkdir -p build && cd build
cmake .. \
    -DCMAKE_C_COMPILER=aarch64-none-linux-gnu-gcc \
    -DCMAKE_CXX_COMPILER=aarch64-none-linux-gnu-g++ \
    -DCMAKE_SYSROOT=<SDK_DIR>/output/ubuntu \
    -DLV_USE_RK_DEMO=ON
make -j$(nproc)

# rkadk — Rockchip 应用开发框架
cd app/rkadk
mkdir -p build && cd build
cmake .. \
    -DCMAKE_C_COMPILER=aarch64-none-linux-gnu-gcc \
    -DCMAKE_CXX_COMPILER=aarch64-none-linux-gnu-g++ \
    -DRKADK_CHIP=rk3588 \
    -DBUILD_EXAMPLES=ON
make -j$(nproc)
```

### **Qt 应用构建（forlinx\_ubuntu\_qt）**

SDK 的 Ubuntu rootfs 已预装 Qt5 运行库。使用**目标平台的 qmake** 交叉编译：

```Bash
# 方式一：在开发板上原生编译（推荐，无需交叉工具链）
# 将 app/forlinx/forlinx_ubuntu_qt/ 拷贝到开发板
scp -r app/forlinx/forlinx_ubuntu_qt forlinx@<board_ip>:~/
ssh forlinx@<board_ip>
cd ~/forlinx_ubuntu_qt
qmake examples.pro
make -j4
sudo make install

# 方式二：SDK 主机交叉编译（使用 Buildroot 的 qmake）
# 注：build.sh 中引用的 qmake 路径为
# buildroot/output/forlinx_ok3588/host/bin/qmake
# 仅当使用 Buildroot rootfs 时可用
```

### **Shell 测试脚本**

测试脚本无需编译，可直接固化到 rootfs 或拷贝到开发板运行：

```Bash
# 固化到 rootfs
cp -r app/test_scripts/* output/ubuntu/opt/test_scripts/

# 调试时，通过 scp 拷贝到开发板
scp -r app/test_scripts/* forlinx@<board_ip>:/opt/test_scripts/
ssh forlinx@<board_ip>
cd /opt/test_scripts
sudo ./setup.sh    # 运行全部测试
# 或单独执行某个测试
sudo ./wifi.sh
sudo ./cam.sh
```

### **固化到 rootfs（生产发布）**

应用程序统一安装到 rootfs 的 `/opt` 目录，随系统镜像一起烧录：

```Bash
# ROOTFS_DIR 为 Ubuntu rootfs 组装目录
ROOTFS_DIR="$PWD/output/ubuntu"

# 1. Makefile 类应用 — 安装到 rootfs
cd app/forlinx/forlinx_cmd
make -j$(nproc)
make install INSTALL_PATH=$ROOTFS_DIR/opt

# 2. CMake 类应用 — 安装到 rootfs
cd app/lvgl_demo/build
make install DESTDIR=$ROOTFS_DIR

cd app/rkadk/build
make install DESTDIR=$ROOTFS_DIR

# 3. 拷贝额外产物（quectelCM 等无 install 目标的应用）
cp app/forlinx/quectelCM/quectelCM $ROOTFS_DIR/opt/
cp app/forlinx/quectelCM/quectel-qmi-proxy $ROOTFS_DIR/opt/

# 4. 固化完成后，重新打包固件
./build.sh firmware
./build.sh updateimg
# 烧录 output/firmware/update.img 即可
```

### **调试拷贝（开发调试）**

调试阶段可通过网络将编译产物拷贝到开发板运行，避免反复烧录：

```Bash
# 通过 scp 拷贝单个二进制到 /opt
scp <binary> forlinx@<board_ip>:/opt/

# 拷贝整个应用目录
scp -r <app_dir> forlinx@<board_ip>:/opt/

# 开发板上直接运行
ssh forlinx@<board_ip>
cd /opt/<app_dir>
./<binary>

# 也可通过 U 盘 / TF 卡拷贝，或挂载 NFS 共享目录
```

## **10\. 常见问题**

|问题|原因|解决|
|---|---|---|
|`python2 missing`|U\-Boot 构建脚本依赖 python2|`sudo apt install python2` 或 `ln -s python3 /usr/bin/python2`|
|`lz4 too old`|内核需要 lz4 \>= 1\.9\.4|从 GitHub 编译安装 v1\.9\.4|
|`gmp header missing`|缺少 libgmp\-dev|`sudo apt install libgmp-dev`|
|`mpc header missing`|缺少 libmpc\-dev|`sudo apt install libmpc-dev`|
|`sudo mount` 需要密码|模块安装需挂载 rootfs 镜像|配置 sudo NOPASSWD|
|`fatal: 不是 git 仓库`|源码不含 \.git 目录|无害警告，可忽略|

## **11\. 关键文件速查**

|用途|路径|
|---|---|
|产品手册|`1-手册/0-OK3588-C&OK3588-C21_产品使用手册.pdf`|
|RK3588 数据手册|`4-原厂资料/Rockchip RK3588 Datasheet V1.7-20231117.pdf`|
|RK3588 TRM Part1|`4-原厂资料/Rockchip RK3588 TRM V1.0-Part1-20220309.pdf`|
|RK3588 TRM Part2|`4-原厂资料/Rockchip RK3588 TRM V1.0-Part2 20220309.pdf`|
|模块支持列表|`1-手册/1-OK3588-C&OK3588-C21_Forlinx_Desktop22.04_模块支持列表_20260623.xlsx`|
|引脚复用对照表|`1-手册/2-FET3588_引脚复用对照表_20241202.xlsx`|
|引脚功能对照表|`1-手册/3-FET3588_引脚功能对照表20250702.xlsx`|
|内核 defconfig|`kernel/arch/arm64/configs/OK3588-C-linux_defconfig`|
|设备树 DTS|`kernel/arch/arm64/boot/dts/rockchip/OK3588-C-linux.dts`|
|公共 DTSI|`kernel/arch/arm64/boot/dts/rockchip/OK3588-C-common.dtsi`|
|U\-Boot defconfig|`u-boot/configs/OK3588-C-linux_defconfig`|
|SDK defconfig|`device/forlinx/.chips/ok3588/OK3588_C_ubuntu22_defconfig`|





