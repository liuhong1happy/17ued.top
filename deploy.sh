#!/usr/bin/expect -f
# 部署脚本 - 构建并上传到服务器

# 从 .password 文件读取密码
set f [open "./.password" r]
set password [read -nonewline $f]
close $f

set timeout 120
set host "8.137.176.191"
set user "root"
set remoteDir "/var/www/17ued.top"

# 1. 安装 Nginx（如果未安装）
spawn ssh $user@$host "
    which nginx && echo 'nginx_installed' || (apt-get update -qq && apt-get install -y -qq nginx && echo 'nginx_installed')
"
expect {
    "password:" { send "$password\r"; exp_continue }
    "yes/no" { send "yes\r"; exp_continue }
    eof { puts "1/4 Nginx安装/检查完成" }
}

# 2. 远程目录准备
spawn ssh $user@$host "rm -rf $remoteDir && mkdir -p $remoteDir"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { puts "2/4 远程目录准备完成" }
}

# 3. 上传 dist 目录内容到远程
spawn scp -r ./dist/. $user@$host:$remoteDir/
expect {
    "password:" { send "$password\r"; exp_continue }
    "yes/no" { send "yes\r"; exp_continue }
    eof { puts "3/4 dist 目录上传完成" }
}

# 4. 重载 Nginx + 验证（不覆盖配置，SSL 由 certbot 管理）
spawn ssh $user@$host "
    rm -f /etc/nginx/sites-enabled/default 2>/dev/null
    nginx -t && nginx -s reload
    echo '--- 部署文件列表 ---'
    find $remoteDir -type f
    echo ''
    echo '--- HTTPS 状态 ---'
    curl -sI https://17ued.top 2>&1 | head -3
"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { puts "4/4 部署完成！" }
}
