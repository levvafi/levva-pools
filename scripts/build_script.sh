#!/bin/bash

set -e

echo "build contracts"
yarn workspace @marginly/contracts install
yarn workspace @marginly/contracts compile

echo "build router"
yarn workspace @marginly/router install
yarn workspace @marginly/router compile

echo "build periphery"
yarn workspace @marginly/periphery install
yarn workspace @marginly/periphery compile

echo "build timelock"
yarn workspace @marginly/timelock install
yarn workspace @marginly/timelock compile

echo "build common"
yarn workspace @marginly/common install
yarn workspace @marginly/common build

echo "build logger"
yarn workspace @marginly/logger install
yarn workspace @marginly/logger build

echo "build logger-node"
yarn workspace @marginly/logger-node install
yarn workspace @marginly/logger-node build

echo "build deploy"
yarn workspace @marginly/deploy install
yarn workspace @marginly/deploy build

echo "build keeper"
yarn workspace @marginly/keeper install
yarn workspace @marginly/keeper build

echo "build cli"
yarn workspace @marginly/cli install
yarn workspace @marginly/cli build

echo "build int-tests"
yarn workspace @marginly/int-tests install
yarn workspace @marginly/int-tests compile
yarn workspace @marginly/int-tests build
