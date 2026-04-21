#!/bin/sh

set -eu

SEED_DIR="/seed/minio/demo-bucket"

if [ ! -d "$SEED_DIR" ]; then
  echo "[seed-minio-restore] seed directory not found: $SEED_DIR" >&2
  exit 1
fi

if grep -R -m 1 -l "version https://git-lfs.github.com/spec/v1" "$SEED_DIR" >/dev/null 2>&1; then
  echo "[seed-minio-restore] seed objects are still Git LFS pointers; run git lfs pull first." >&2
  exit 1
fi

set -- "$SEED_DIR"/*
if [ "$1" = "$SEED_DIR/*" ]; then
  echo "[seed-minio-restore] seed directory is empty; skip restore."
  exit 0
fi

mc alias set target http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null 2>&1
mc mb --ignore-existing "target/$MINIO_BUCKET" >/dev/null 2>&1

OBJECT_COUNT="$(mc ls --recursive "target/$MINIO_BUCKET" | wc -l | tr -d ' ')"
if [ "${OBJECT_COUNT:-0}" != "0" ]; then
  echo "[seed-minio-restore] bucket already has objects; skip restore."
  exit 0
fi

# 逻辑回灌对象，而不是复制 MinIO 底层数据目录，避免与不同版本的内部存储布局耦合。
mc mirror --overwrite "$SEED_DIR" "target/$MINIO_BUCKET"

echo "[seed-minio-restore] done"
