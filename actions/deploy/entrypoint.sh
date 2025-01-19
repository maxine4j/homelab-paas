#!/usr/bin/env bash

cd ./actions/deploy || exit 1
yarn install --frozen-lockfile
yarn deploy
