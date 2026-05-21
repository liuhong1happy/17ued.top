#!/usr/bin/expect -f
# 设置 Let's Encrypt SSL 证书脚本

set f [open "./.password" r]
set password [read -nonewline $f]
close $f

set timeout 120
set host "8.137.176.191"
set user "root"
set domain "17ued.top"
set email "admin@17ued.top"

# 检查 certbot 版本
spawn ssh $user@$host "
    which certbot 2>/dev/null && echo 'certbot_installed' && certbot --version 2>&1 || echo 'certbot_not_installed'
"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { }
}

# 如果没有 certbot，安装 snapd 并用 snap 安装
spawn ssh $user@$host "
    if ! which certbot 2>/dev/null; then
        echo '--- Installing certbot via snap ---'
        apt-get update -qq 2>/dev/null
        apt-get install -y -qq snapd 2>/dev/null
        snap install core 2>/dev/null
        snap refresh core 2>/dev/null
        snap install --classic certbot 2>/dev/null
        ln -sf /snap/bin/certbot /usr/bin/certbot
    fi
    which certbot && echo 'certbot_ready'
"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { puts "certbot 安装完成" }
}

# 创建临时 nginx 配置用于验证（HTTP 验证）
spawn ssh $user@$host "
    cat > /etc/nginx/conf.d/17ued.top.conf << 'CONFEOF'
server {
    listen 80;
    server_name $domain;
    root /var/www/17ued.top;
    index index.html;

    # Let's Encrypt 验证
    location ~ /.well-known/acme-challenge/ {
        root /var/www/17ued.top;
    }

    location / {
        try_files \$uri /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        expires max;
        add_header Cache-Control "public";
    }
}
CONFEOF
    nginx -t && nginx -s reload && echo 'nginx_ready'
"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { puts "nginx 配置准备完成" }
}

# 获取证书（如果之前有旧的先删除以免冲突）
spawn ssh $user@$host "
    certbot delete --cert-name $domain --non-interactive 2>/dev/null
    certbot --nginx --domain $domain --non-interactive --agree-tos --email $email --redirect
    echo '--- certbot done ---'
"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { puts "证书获取完成" }
}

# 验证最终配置
spawn ssh $user@$host "
    echo '=== 最终 nginx 配置 ==='
    cat /etc/nginx/conf.d/17ued.top.conf 2>/dev/null
    echo ''
    echo '=== 测试 HTTPS ==='
    curl -sI https://$domain 2>&1 | head -5
    echo ''
    echo '=== 证书信息 ==='
    certbot certificates 2>&1
"
expect {
    "password:" { send "$password\r"; exp_continue }
    eof { puts "验证完成" }
}

puts "✅ SSL 证书配置完成！"
