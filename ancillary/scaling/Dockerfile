FROM python:3.9-slim

# Set the working directory
WORKDIR /app

# Copy the Python script into the container
COPY scaling.py .

# Install the required dependencies
RUN pip install kubernetes pytz

# Command to run the Python script
CMD ["python", "scaling.py"]