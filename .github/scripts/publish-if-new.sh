#!/bin/sh
# Publish a workspace package unless its current version is already on
# the registry, so re-running a tagged release stays idempotent.
set -eu

workspace="$1"
name=$(node -p "require('./$workspace/package.json').name")
version=$(node -p "require('./$workspace/package.json').version")

if npm view "$name@$version" version >/dev/null 2>&1; then
  echo "$name@$version already published; skipping."
  exit 0
fi

npm publish --workspace "$workspace" --access public
