# Reproduces how most Linux users install the app: Ubuntu 26.04 with node 22 + npm 9.2 from apt.
# Its global folder (/usr/local) is root-owned, so `npm i -g` needs sudo, and Electron then can't download its binary on first run as the normal user.
# bin/claude-discover.mjs must catch that and print the nvm reinstall steps instead of a stack trace.
# There's no display, so a missing-libglib launch error means Electron installed fine.
#
#   Build:               docker build -t claude-discover-ubuntu -f test/docker/ubuntu.Dockerfile test/docker
#   Shell:               docker run -it --rm -v .:/pkg claude-discover-ubuntu
#   Verify published:    docker run --rm claude-discover-ubuntu bash -c "sudo npm i -g claude-discover && claude-discover"
#   Verify local pack:   npm pack; docker run --rm -v .:/pkg claude-discover-ubuntu bash -c "sudo npm i -g /pkg/*.tgz && claude-discover"

FROM ubuntu:26.04

RUN apt-get update && apt-get install -y --no-install-recommends nodejs npm sudo ca-certificates wget \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -m -s /bin/bash user && echo 'user ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/user

USER user
WORKDIR /home/user
