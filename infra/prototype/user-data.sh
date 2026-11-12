#!/bin/bash
# 프로토타입 EC2(Ubuntu 24.04 arm64) 첫 부팅 설정. 비밀값을 넣지 않는다(절대 규칙 2).
# - Docker·Compose v2·git 설치, 빌드용 스왑 4GB(t4g.small은 메모리 2GB)
# - GitHub 읽기 전용 배포 키를 서버 안에서 만든다(공개키만 밖으로 꺼내 GitHub에 등록)
# 접속은 SSH가 아니라 SSM으로만 한다(22번 포트를 열지 않음, 기획서 T10-4).
set -euxo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y docker.io docker-compose-v2 git unattended-upgrades
systemctl enable --now docker

if [ ! -f /swapfile ]; then
  fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

install -d -m 700 /root/.ssh
if [ ! -f /root/.ssh/crm_deploy ]; then
  ssh-keygen -t ed25519 -N '' -C 'crm-proto-server' -f /root/.ssh/crm_deploy
fi
cat > /root/.ssh/config <<'CFG'
Host github.com
  IdentityFile /root/.ssh/crm_deploy
  IdentitiesOnly yes
CFG
ssh-keyscan -t ed25519 github.com >> /root/.ssh/known_hosts
install -d -m 750 /opt/crm
