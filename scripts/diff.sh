#!/usr/bin/env bash
# 导出 git 改动为 .patch（中文路径原样输出，不转义；同名文件每次覆盖）
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

BASE="HEAD"
STAGED=0
OUT="$(basename "$(git rev-parse --show-toplevel)").patch"

usage() {
  cat <<'EOF'
用法: scripts/diff.sh [-o 输出文件] [-r 基准版本] [-s] [--] [路径...]

  -o  输出文件名（默认: <仓库名>.patch，每次覆盖）
  -r  对比的基准版本（默认 HEAD）
  -s  只导出已暂存（staged）的改动
  -h  显示本帮助

示例:
  scripts/diff.sh                              # 工作区 vs HEAD
  scripts/diff.sh -o 改动.patch                # 指定输出名
  scripts/diff.sh -r HEAD~1                    # 跟上一次提交比
  scripts/diff.sh -- content/message-reader.js # 只导某个文件
  scripts/diff.sh -s                           # 只导 git add 过的改动
EOF
}

while getopts ":o:r:sh" opt; do
  case "$opt" in
    o) OUT="$OPTARG" ;;
    r) BASE="$OPTARG" ;;
    s) STAGED=1 ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

# 关键：core.quotepath=false，中文文件名原样输出，不再是 \344\277\256 这种
ARGS=(git -c core.quotepath=false diff --no-color --binary)
if [ "$STAGED" -eq 1 ]; then
  ARGS+=(--cached)
fi
ARGS+=("$BASE" --)
if [ "$#" -gt 0 ]; then
  ARGS+=("$@")
fi

mkdir -p "$(dirname "$OUT")"

# 直接覆盖，不生成带日期的副本
"${ARGS[@]}" > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "没有可导出的改动（基准: $BASE）"
  rm -f "$OUT"
  exit 1
fi

STAT_ARGS=(git -c core.quotepath=false diff --stat "$BASE" --)
if [ "$STAGED" -eq 1 ]; then
  STAT_ARGS=(git -c core.quotepath=false diff --cached --stat "$BASE" --)
fi
if [ "$#" -gt 0 ]; then
  STAT_ARGS+=("$@")
fi

echo "已导出: $OUT ($(wc -c < "$OUT") 字节)"
"${STAT_ARGS[@]}"

# 反向校验：能反向套用，说明补丁结构完整
if git apply --check --reverse "$OUT" 2>/dev/null; then
  echo "校验通过: 可 git apply 正向套用 / git apply -R 反向还原"
else
  echo "提示: 反向校验未通过（常见于含新文件或已暂存改动），补丁本身仍已生成"
fi
