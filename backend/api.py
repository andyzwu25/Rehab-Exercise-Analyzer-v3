from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import shutil
import os

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
os.makedirs("output_videos", exist_ok=True)
app.mount("/outputs", StaticFiles(directory="output_videos"), name="outputs")

# 3. The exact endpoint your JavaScript is trying to fetch
@app.post("/analyze")
async def analyze_video(video: UploadFile = File(...)):
    
    # A. Save the uploaded video temporarily to your computer
    temp_input_path = f"temp_{video.filename}"
    with open(temp_input_path, "wb") as buffer:
        shutil.copyfileobj(video.file, buffer)
        
    # B. Define where the annotated video will be saved
    output_filename = f"processed_{video.filename}"
    output_filepath = f"output_videos/{output_filename}"
    
    # C. RUN YOUR AI LOGIC (This is the bridge!)
    # This runs the video through MediaPipe and returns the real data
    total_squats, depth_score = process_video_file(temp_input_path, output_filepath)
    
    # D. Clean up the temporary input file
    if os.path.exists(temp_input_path):
        os.remove(temp_input_path)
        
    # E. Send the results back to your HTML page!
    return {
        "total_squats": total_squats,
        "depth_score": depth_score,
        "processed_video_url": f"http://localhost:8000/outputs/{output_filename}"
    }