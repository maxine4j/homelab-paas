#!/bin/bash

# Define the container name
CONTAINER_NAME="homelab-paas"

# Define build context and Dockerfile
DOCKERFILE_PATH="./services/paas/Dockerfile"
BUILD_CONTEXT="./"

# Define port and volume mappings
PORT_MAPPING="8080:8080"
VOLUME_MAPPING="/var/run/docker.sock:/var/run/docker.sock"

# 1. Check if a container with the same name is already running
if docker ps -a --format '{{.Names}}' | grep -q "${CONTAINER_NAME}"; then
  echo "Container '${CONTAINER_NAME}' already exists. Stopping and removing it..."
  
  # 2. Stop the running container
  docker stop ${CONTAINER_NAME}
  
  # 3. Remove the stopped container
  docker rm ${CONTAINER_NAME}
else
  echo "No existing container '${CONTAINER_NAME}' found."
fi

# 4. Build the Docker image
echo "Building the Docker image..."
docker build -t ${CONTAINER_NAME}:latest -f ${DOCKERFILE_PATH} ${BUILD_CONTEXT}

# 5. Run the container with the same ports and volume as the Compose file
echo "Running the container '${CONTAINER_NAME}'..."
docker run \
  --interactive \
  --tty \
  --name ${CONTAINER_NAME} \
  -p ${PORT_MAPPING} \
  -v ${VOLUME_MAPPING} \
  ${CONTAINER_NAME}

# 6. Output the status of the container
docker ps -f name=${CONTAINER_NAME}
