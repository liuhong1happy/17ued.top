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

