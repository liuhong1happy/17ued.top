# 服务器

## 添加账号

```Bash
# 添加用户
sudo adduser 用户名
# 赋予sudo权限
sudo usermod -aG sudo 用户名

```

确保 “必须输密码”

```Bash
%sudo   ALL=(ALL:ALL) ALL
```

## 扩容磁盘

```Bash
# 安装扩容工具
sudo apt update 
sudo apt install -y cloud-guest-utils gdisk  

# 扩展分区：磁盘/dev/vda，分区编号1（注意中间空格，不是vda1）
sudo growpart /dev/vda 1

# 扩展ext4文件系统
sudo resize2fs /dev/vda1  

# 校验结果
df -h / 
lsblk
```

# Gitlab CI/CD

## gitlab\-runner

```Bash
systemctl restart gitlab-runner # 重启gitlab-runner
systemctl enable gitlab-runner # 开机启动
systemctl status gitlab-runner # 运行状态
```

## 查看gitlab\-runner配置文件

```Bash
sudo vim /etc/gitlab-runner/config.toml
```

## 添加runner

```Bash
sudo gitlab-runner register  --url http://192.168.10.200  --token <your-runner-token>
```

## 允许操作文件和docker

```Bash
sudo usermod -aG docker gitlab-runner
sudo usermod -aG root gitlab-runner
```



# Docker

## 构建缓存清理

```Bash
# 查看占用
du -sh /var/lib/docker/overlay2  
# 清理悬空镜像与无用容器
docker system prune -a
# 仅清理未使用镜像层
docker image prune -a
```

## 镜像加速

```JSON
{
    "registry-mirrors": [
        "https://docker.1ms.run",
        "https://docker-0.unsee.tech",
        "https://docker.m.daocloud.io",
        "https://registry-1.docker.io"
     ]
 }
```

配置后需要重启docker

```Bash
sudo systemctl daemon-reload
sudo systemctl restart docker
```

## 重启服务

```Bash
docker restart <image_name>
```

# Docker和K8S 都不走代理网络

```Bash
mkdir -p /etc/systemd/system/kubelet.service.d

cat > /etc/systemd/system/kubelet.service.d/10-no-proxy.conf <<EOF
[Service]
Environment="NO_PROXY=localhost,127.0.0.1,.cluster.local,.svc,10.0.0.0/8,10.96.0.0/12,192.168.0.0/16,172.16.0.0/12"
Environment="no_proxy=localhost,127.0.0.1,.cluster.local,.svc,10.0.0.0/8,10.96.0.0/12,192.168.0.0/16,172.16.0.0/12"
EOF

systemctl daemon-reload 
systemctl restart kubelet

mkdir -p /etc/systemd/system/docker.service.d

cat > /etc/systemd/system/docker.service.d/http-proxy.conf <<EOF
[Service]
Environment="NO_PROXY=localhost,127.0.0.1,.cluster.local,.svc,10.0.0.0/8,10.96.0.0/12,192.168.0.0/16,172.16.0.0/12"
Environment="no_proxy=localhost,127.0.0.1,.cluster.local,.svc,10.0.0.0/8,10.96.0.0/12,192.168.0.0/16,172.16.0.0/12"
EOF

systemctl daemon-reload
systemctl restart docker
```

注意：

```YAML
10.0.0.0/8        # K8s 常用 Service 网段
10.96.0.0/12      # 你的 CoreDNS 就在这里
192.168.0.0/16    # 你的宿主机局域网
172.16.0.0/12     # Docker 网桥默认段
.cluster.local    # K8s 集群域名
.svc              # Service 域名
```

测试：

```Bash
kubectl exec -i -t dnsutils-5b5bb886c5-t9zz6 -- nslookup kubernetes.default
```



## Nexus

https://blog\.csdn\.net/qq\_53374893/article/details/155744021

# Nginx

```Bash
sudo nginx -s reload
```

# Xrdp 远程桌面

[https://cloud.tencent.com/developer/article/2428030]()

# SSH 客户端 WindTerm

WindTerm 是一款跨平台的 SSH / Sftp / Shell / Telnet / Tmux / Serial 终端工具，由 kingToolbox 开发，主体用 C 语言编写，**启动快、内存占用低**，是 Xshell、PuTTY、MobaXterm 之外的一个常见选择，免费用于商用与非商用场景。

项目地址：[https://github.com/kingToolbox/WindTerm](https://github.com/kingToolbox/WindTerm)

## 主要特性

| 能力 | 说明 |
| --- | --- |
| 协议支持 | SSH v2、Telnet、Raw TCP、Serial（串口）、Shell，可与 tmux 配合 |
| 会话管理 | 会话树分组、标签页、分屏、多窗口 |
| 文件传输 | 内置 SFTP / SCP 客户端与本地文件管理器，支持拖拽上传下载 |
| 端口转发 | 本地转发、远程转发、动态 SOCKS 代理 |
| 跳板机 | 支持 ProxyJump、ProxyCommand、ControlMaster |
| 认证方式 | 密码、公钥、keyboard-interactive、GSSAPI；支持 SSH Agent 及 Agent 转发 |
| 其他转发 | X11 转发 |
| 效率功能 | 命令自动补全、命令面板（Command Palette）、命令发送器、同步输入（Sync Input） |
| 界面 | 多语言（含中文）、深色主题、vim 键位、Powerline 字体、Unicode 13 |

## 实用技巧

**绿色便携**：WindTerm 默认是便携模式，配置、会话与密钥都保存在程序目录的 `.wind/` 下，把整个目录拷到另一台机器即可完成迁移，不必重新配置。

**同步输入（Sync Input）**：需要在多台机器上执行同一条命令时（比如批量改配置、批量看状态），开启同步输入后，在任意一个会话中敲的命令会同时下发到所有已同步的会话。

**自动补全**：可以结合历史命令和内置命令表给出提示，也可以把已有 shell 的历史记录导入，快速积累常用命令。

**跳板机**：在会话的代理设置里选 ProxyJump（等价于 `ssh -J 用户@跳板机`）或 ProxyCommand，比在服务器上维护 `~/.ssh/config` 更直观。

## 选型提示

- **许可**：官方表述是“部分开源”（partial open source），已公开部分的源码使用 Apache-2.0 许可（`thirdparty` 目录除外），Windows 版本源码未公开。不要按“完全开源”来评估。
- **维护节奏**：更新较慢，长期停留在 2.x 阶段，最新的还是 2.7.0 的预发布版本，issue 积压较多。作为日常工具足够好用，但如果团队要长期标准化使用，建议同时评估其他客户端。

## 同类工具对比

| 工具 | 平台 | 许可 | 特点 |
| --- | --- | --- | --- |
| WindTerm | Win / macOS / Linux | 免费，部分开源 | 轻量、启动快，功能全，更新慢 |
| Xshell | Windows | 商业（有免费版，商用需授权） | 老牌工具，稳定，中文支持好 |
| MobaXterm | Windows | 商业（有免费版，功能受限） | 内置 X Server 与多标签，功能大而全 |
| FinalShell | Win / macOS / Linux | 免费为主 | 国产，自带服务器监控面板 |
| Tabby | Win / macOS / Linux | 开源（MIT） | 现代化界面，插件化 |
| PuTTY | Windows | 开源（MIT） | 极简、稳定，缺少标签页与文件管理 |

# 数据库管理工具 Navicat

Navicat 是一款商业数据库管理工具，其中 **Navicat Premium** 可以用同一个界面连接多种数据库，是运维和开发排查线上数据时最常用的图形化客户端之一。

官网：[https://www.navicat.com.cn/](https://www.navicat.com.cn/)

## 支持的数据库

MySQL、MariaDB、PostgreSQL、SQL Server、Oracle、SQLite、MongoDB、Redis、Snowflake，以及 OceanBase、TiDB、达梦（DM）、KingbaseES、GaussDB 等国产数据库。

## 版本与功能

官方只提供 **14 天全功能试用**，正式使用需要购买授权；另外提供免费的 **Navicat Premium Lite**（功能精简），日常只做连接、查数据、写 SQL 的话够用。

| 功能 | Lite 版 | 企业版 |
| --- | --- | --- |
| 连接管理、SSH / HTTP / SSL 安全连接 | 支持 | 支持 |
| 数据查看与编辑、查询编辑器、代码补全、SQL 格式化、深色模式 | 支持 | 支持 |
| 结构同步、数据传输、数据同步 | — | 支持 |
| 备份与还原、自动运行（计划任务） | — | 支持 |
| ER 图、数据建模、BI 可视化 | — | 支持 |
| 服务器监控、命令监控 | — | 支持 |
| AI 助手 | — | 支持 |

## 常用场景

**SSH 隧道连生产库**：生产环境的数据库通常不对外暴露端口，在连接配置的 SSH 页签里填跳板机信息，Navicat 会自动建立隧道，不用手工 `ssh -L`。

**结构与数据同步**：换库、搭测试环境、对比两个环境差异时，用结构同步看 DDL 差异，用数据同步比对行级差异，比手工导表可靠。

**数据传输（Data Transfer）**：跨数据库类型迁移时很有用，比如 MySQL 导到 PostgreSQL，会自动做字段类型映射。

**计划任务**：把定期备份、定期同步配成批处理作业，省掉自己写 crontab + mysqldump。

## 注意事项

- **图形化工具方便，但不要把生产库的日常运维完全交给它**。批量 UPDATE、DELETE 前先备份，或者先用同样的 `WHERE` 条件跑 `SELECT COUNT(*)` 确认影响行数。
- Navicat 本地保存的数据库密码建议开启主密码保护，避免直接明文落盘。
- 生产环境的数据导出、下载要注意数据安全要求，必要时脱敏。

## 同类工具对比

| 工具 | 平台 | 许可 | 特点 |
| --- | --- | --- | --- |
| Navicat | Win / macOS / Linux | 商业（14 天试用 + 免费 Lite 版） | 界面友好，功能全，多数据库统一管理 |
| DBeaver | Win / macOS / Linux | 社区版开源免费 | 支持数据库极多，社区版功能已足够日常使用 |
| DataGrip | Win / macOS / Linux | 商业订阅 | JetBrains 出品，SQL 智能提示与重构最强 |
| HeidiSQL | Windows | 开源免费 | 轻量，但只支持 MySQL 系与 SQL Server、PostgreSQL |

# 防火墙

```Bash
sudo firewall-cmd --add-port=6008/tcp --permanent
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
```

# 安装Chrome浏览器

```Bash
sudo apt install chromium-browser -y
```

# 证书生成和自动续期（Nginx）

```Bash
# 添加证书
sudo certbot --nginx -d neme.ai -d www.neme.ai
# 自动续期证书
sudo crontab -e
# 30 3 * * * /usr/bin/certbot renew --quiet && systemctl restart nginx
```

# Ubuntu 22\.04 安装

https://phoenixnap\.com/kb/ubuntu\-22\-04\-lts

# Python添加pip国内镜像库

```Bash
pip config set global.index-url  https://mirrors.aliyun.com/pypi/simple/
pip config set install.trusted-host mirrors.aliyun.com
```

# vLLM安装

依赖

1. CUDA Toolkit

2. CUDA Driver

测试

```Bash
pip3 config set global.index-url https://mirrors.aliyun.com/pypi/simple/
pip3 config set install.trusted-host mirrors.aliyun.com

pip3 install tensorflow
pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

```Bash
import tensorflow as tf
print(tf.config.list_physical_devices('GPU'))
```

```Python
import torch
print(torch.cuda.is_available())    # True = 成功
print(torch.cuda.device_count())    # 2 = 两张显卡都识别
print(torch.cuda.get_device_name(0)) # 2080Ti
```

安装

```Bash
pip3 install numpy==1.26.4 tensorflow==2.10.1 vllm --extra-index-url https://download.pytorch.org/whl/cu118
```

验证

```Bash

echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

VLLM_USE_MODELSCOPE=true TF_ENABLE_ONEDNN_OPTS=0  vllm serve Qwen/Qwen3-0.6B --enable-reasoning --reasoning-parser deepseek_r1
```

