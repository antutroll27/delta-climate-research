# Raspberry Pi relay: using the Pi from a Mac

**Date:** 28 September 2026
**Status:** Decided, not set up. The founder chose VS Code Remote-SSH over Tailscale on 28 Sep 2026.
**Part of:** [the Raspberry Pi relay docs](./README.md).

## 1. What you will and won't see

Raspberry Pi OS **Lite** has **no desktop**; it is a text terminal. That is deliberate: it is lighter and more reliable for an always-on relay. So there is no graphical "screen" to mirror. Instead, the Mac works on the Pi's files and terminal directly, which is everything this job needs: editing the config, reading logs, restarting the service.

## 2. The chosen set-up: VS Code Remote-SSH over Tailscale

| Piece | What it does | Cost |
|---|---|---|
| **Tailscale** | A private network between the Mac and the Pi that works from anywhere (office, home, travelling), with **no router ports opened** | Free "Personal" plan (a few users, up to about 100 devices) |
| **SSH** on the Pi | Secure remote login (keys only, no passwords) | Free, built in |
| **VS Code** + **Remote-SSH** extension | VS Code on the Mac opens folders and terminals *on the Pi*, so it feels like working locally | Free |
| **Raspberry Pi Connect** | Backup: a terminal on the Pi from any browser at connect.raspberrypi.com | Free |

**Total extra cost: ₹0**, on top of the Pi hardware.

**Licence check (when setting up):** Tailscale's free plan is aimed at personal use. If several team members will connect for company work, check Tailscale's current pricing page. Their small team plan has been around US$6 per user per month. One person connecting fits the free plan.

## 3. Set-up steps

1. **Tailscale**
   - Install Tailscale on the Mac (App Store or tailscale.com) and sign in.
   - On the Pi, run `curl -fsSL https://tailscale.com/install.sh | sh`, then `sudo tailscale up`, and approve the Pi in the Tailscale admin page.
   - Optionally, turn off key expiry for the Pi so it never drops off the network.
2. **SSH keys**
   - On the Mac, `ssh-keygen -t ed25519` if you have no key.
   - Copy it to the Pi with `ssh-copy-id <user>@obos-relay-1`, using the Pi's Tailscale name.
   - On the Pi, set `PasswordAuthentication no` in `/etc/ssh/sshd_config`, then restart ssh.
3. **VS Code**
   - Install the **Remote - SSH** extension.
   - Open the Command Palette and choose "Remote-SSH: Connect to Host…", then `<user>@obos-relay-1`.
   - Open the `~/obos-india` folder; the terminal inside VS Code now runs on the Pi.
4. **Raspberry Pi Connect (backup)**
   - On the Pi, run `sudo apt install rpi-connect-lite`, then `rpi-connect signin`.
   - It then appears at connect.raspberrypi.com under "Remote shell".

## 4. If you ever want the Pi's desktop in a window

That needs **Raspberry Pi OS with desktop** instead of Lite, plus **Raspberry Pi Connect screen sharing** (free) or VNC. A Pi 4 with 4 GB copes, but the relay then carries a desktop it never uses. It is not recommended for this job.

## 5. Rehearse on the Mac before the Pi arrives (optional)

A Linux VM already exists for this: **Debian 13 arm64** (the base of current Raspberry Pi OS) under **Lima** (free, command line), stored on the portable SSD in `Pi Lab/PiLab.sparsebundle`. The SSD is exFAT, which cannot hold a VM directly, so the VM lives inside that Mac disk image.

- Start: double-click the sparsebundle to mount `PiLab`, then `LIMA_HOME=/Volumes/PiLab/lima limactl start pi`, and `limactl shell pi` for a terminal.
- Stop before unplugging the SSD: `LIMA_HOME=/Volumes/PiLab/lima limactl stop pi`, then eject `PiLab`.
- The Mac's home folder is visible read-only inside the VM at its Mac path, so a binary built on the Mac runs there without copying.

It is good for practising `setup.sh` and testing the service under real systemd. It is not a Pi: there is no `raspi-config`, read-only overlay or Pi hardware watchdog, so those are tried on Pi day. (UTM, a free app with a window, would also work.)

Caveat: the VM uses the Mac's internet connection, which may or may not reach CPCB. It proves the software, not the Indian connection, and it does not replace the always-on Pi.
