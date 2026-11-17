#!/bin/sh
/usr/bin/security find-generic-password -s "com.termilal.ssh" -a "$TERMINAL_SECRET_ACCOUNT" -w 2>/dev/null
