# Use an official, stable lightweight Python runtime
FROM python:3.11-slim

# Install the exact visual graphics libraries MediaPipe needs to run on a headless server
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy the requirements file and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of your backend code into the container
COPY . .

# Start the Uvicorn server on port 10000
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "10000"]