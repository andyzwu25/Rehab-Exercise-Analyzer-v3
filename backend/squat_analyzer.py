import cv2
import mediapipe as mp
import numpy as np

from collections import deque
mp_pose = mp.solutions.pose

# --- GLOBAL INITIALIZATION ---
# Initialize the model once the server boots up.
# This prevents it from creating fresh C++ memory allocations on every upload.
pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)

# --- HELPER: Angle Math ---
def calculate_angle(a, b, c):
    a, b, c = np.array(a), np.array(b), np.array(c)
    radians = np.arctan2(c[1]-b[1], c[0]-b[0]) - np.arctan2(a[1]-b[1], a[0]-b[0]) # Calculates y/x (opposite/adjacent) to find angle at b
    angle = np.abs(radians*180.0/np.pi)
    if angle > 180.0: angle = 360-angle
    return angle

def determine_facing_direction(landmarks):
    """
    Determines both which side of the body is visible and which direction
    the user is facing on the screen.
    """
    left_shoulder = landmarks[11]
    right_shoulder = landmarks[12]

    if right_shoulder.z < left_shoulder.z:
        return "right"
    else:
        return "left"   

def process_video_file(input_video_path, output_video_path):
    knee_history = deque(maxlen=5)

    cap = cv2.VideoCapture(input_video_path)

    # Get the original video's width, height, and FPS
    # so we can save our annotated video with the exact same dimensions
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = int(cap.get(cv2.CAP_PROP_FPS)) if cap.get(cv2.CAP_PROP_FPS) > 0 else 30

    # Define the video writer to save the file as an MP4
    fourcc = cv2.VideoWriter_fourcc(*'XVID')
    out = cv2.VideoWriter(output_video_path, fourcc, fps, (frame_width, frame_height))

    total_squats = 0
    good_depth_squats = 0
    stage = "up"
    depth_achieved = False

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret: break # Video ended

        image = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = pose.process(image)
        image = cv2.cvtColor(image, cv2.COLOR_RGB2BGR) # Switch back for drawing

        if results.pose_landmarks:
            lm = results.pose_landmarks.landmark

            # --- THE NEW ROBUST GATE ---
            # We check the Hip (24) and Knee (26) instead of the ankle.
            # We also ensure the knee hasn't dropped off the bottom edge of the screen (y > 0.98)
            left_knee = lm[25]
            right_knee = lm[26]

            if (right_knee.y < 0.98 or left_knee.y < 0.98):
                facing_direction = determine_facing_direction(lm)

                if facing_direction == "right":
                    hip = [lm[24].x, lm[24].y]
                    knee = [lm[26].x, lm[26].y]
                else:
                    hip = [lm[23].x, lm[23].y]
                    knee = [lm[25].x, lm[25].y]             


                # Create an imaginary reference point straight DOWN from the hip
                floor_ref = [hip[0], hip[1] + 0.5]
                
                # Calculate the raw thigh angle relative to the floor
                raw_thigh_angle = calculate_angle(floor_ref, hip, knee)
                
                # Smooth the thigh angle using your existing deque logic
                knee_history.append(raw_thigh_angle)
                smoothed_thigh_angle = sum(knee_history) / len(knee_history)
                
                # --- NEW Squat Depth Conditions Using Thigh Angle ---      
                # If thigh opens up past 45 degrees relative to the vertical, you are descending
                if smoothed_thigh_angle > 30 and stage == "up":
                    stage = "down"
                    depth_achieved = False
                
                if stage == "down":
                    # Absolute depth check: If Hip Y is lower than or equal to Knee Y, depth is perfect
                    if hip[1] >= knee[1] - 0.06:
                        depth_achieved = True
                
                # Exit the squat when your thigh gets close to vertical again (under 30 degrees)
                if smoothed_thigh_angle < 30 and stage == "down":
                    stage = "up"
                    if depth_achieved:
                        good_depth_squats += 1
                    total_squats += 1
        out.write(image)

    cap.release()
    out.release()

    cv2.destroyAllWindows()
    
    # Calculate final scores to return to api.py
    depth_score = int((good_depth_squats / total_squats) * 100) if total_squats > 0 else 0
    return total_squats, depth_score