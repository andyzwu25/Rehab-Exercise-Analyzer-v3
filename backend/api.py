from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import psutil
import os
import gc 

def log_memory(step_name):
    process = psutil.Process(os.getpid())
    mb_used = process.memory_info().rss / (1024 * 1024)
    print(f"--- MEMORY USAGE AT [{step_name}]: {mb_used:.2f} MB ---", flush=True)

# Import your squat analyzer logic (we will tweak your main file in Step 3 to allow this)
from squat_analyzer import process_video_file 

app = FastAPI()

# 1. Allow your HTML file to communicate with this Python server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows any frontend to connect
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Tell the server to host a folder called "output_videos" so the frontend can display them
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# 3. The exact endpoint your JavaScript is trying to fetch
@app.post("/analyze")
async def analyze_video(video: UploadFile = File(...)):
    
    log_memory("1. Endpoint Hit / Request Start")

    # A. Save the uploaded video temporarily to your computer
    temp_input_path = f"temp_{video.filename}"
    with open(temp_input_path, "wb") as buffer:
        shutil.copyfileobj(video.file, buffer)

    log_memory("2. After File Saved to Disk")

    # B. Define where the annotated video will be saved
    output_filename = f"processed_{video.filename}"
    raw_opencv_path = f"static/raw_{os.path.splitext(output_filename)[0]}.avi"
    final_web_path = f"static/{output_filename}"
    
    log_memory("3. Right Before MediaPipe AI Engine Launches")

    # C. RUN YOUR AI LOGIC (This is the bridge!)
    # This runs the video through MediaPipe and returns the real data
    total_squats, depth_score = process_video_file(temp_input_path, raw_opencv_path)
    
    log_memory("4. Right After MediaPipe Processing Completes")

    # NEW: Force Python to instantly wipe out memory caches before starting Ffmpeg
    gc.collect()

    log_memory("5. Right After Garbage Collection (Before FFmpeg)")

    # NEW STEP: Convert the raw video to a Web-Friendly H.264 format using FFmpeg
    if os.path.exists(raw_opencv_path):
        os.system(f"ffmpeg -y -nostdin -threads 1 -i {raw_opencv_path} -c:v libx264 -preset ultrafast -pix_fmt yuv420p {final_web_path}")
        os.remove(raw_opencv_path)

    log_memory("6. After FFmpeg Transcoding Engine Halts")

    # D. Clean up the temporary input file
    if os.path.exists(temp_input_path):
        os.remove(temp_input_path)

    log_memory("7. Request Teardown / Return Complete")
        
    # E. Send the results back to your HTML page!
    return {
        "total_squats": total_squats,
        "depth_score": depth_score,
        "processed_video_url": f"https://rehab-exercise-analyzer-v3.onrender.com/static/{output_filename}"
    }