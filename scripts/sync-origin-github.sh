#!/usr/bin/env bash
# Fetch Origin and GitHub, merge main, and push the result to both remotes.
# Never force-pushes. Stops on a dirty tree or a merge conflict.
set -euo pipefail

ORIGIN_REMOTE="${SYNC_ORIGIN_REMOTE:-origin}"
GITHUB_REMOTE="${SYNC_GITHUB_REMOTE:-github}"
BRANCH="${SYNC_BRANCH:-main}"

cd "$(git rev-parse --show-toplevel)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is dirty. Commit or stash first." >&2
  exit 1
fi

current="$(git rev-parse --abbrev-ref HEAD)"
if [ "$current" != "$BRANCH" ] && [ "$current" != "HEAD" ]; then
  echo "Check out $BRANCH before syncing." >&2
  exit 1
fi
if [ "$current" = "HEAD" ]; then
  git checkout -B "$BRANCH"
fi

git fetch "$ORIGIN_REMOTE"
git fetch "$GITHUB_REMOTE"

origin_ref="${ORIGIN_REMOTE}/${BRANCH}"
github_ref="${GITHUB_REMOTE}/${BRANCH}"

git rev-parse --verify "$origin_ref" >/dev/null
git rev-parse --verify "$github_ref" >/dev/null

if [ "$(git rev-parse HEAD)" = "$(git rev-parse "$origin_ref")" ] \
  && [ "$(git rev-parse HEAD)" = "$(git rev-parse "$github_ref")" ]; then
  echo "Origin and GitHub are already in sync at $(git rev-parse --short HEAD)."
  exit 0
fi

git merge --no-edit "$origin_ref"
git merge --no-edit "$github_ref"

git push "$ORIGIN_REMOTE" "$BRANCH"
git push "$GITHUB_REMOTE" "$BRANCH"

echo "Synced $BRANCH to $ORIGIN_REMOTE and $GITHUB_REMOTE at $(git rev-parse --short HEAD)."
