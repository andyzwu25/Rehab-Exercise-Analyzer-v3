// --- 1. SETUP VARIABLES & GEOMETRY MATH ---
const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const repCountDisplay = document.getElementById('repCount');

// Offscreen buffer: we own exactly which pixels MediaPipe sees.
const frameBuffer = document.createElement('canvas');
const frameCtx = frameBuffer.getContext('2d');

let reps = 0;
let isCounting = false;
let runId = 0;
let pose = null;       // rebuilt per video

async function sendFrame(myRun) {
    if (myRun !== runId) return;
    if (videoElement.readyState < 2) return;   // HAVE_CURRENT_DATA — no frame yet
    frameCtx.drawImage(videoElement, 0, 0, frameBuffer.width, frameBuffer.height);
    await pose.send({ image: frameBuffer });
}

// Translation of your Python np.arctan2 math
function calculateAngle(a, b, c) {
    const radians = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let angle = Math.abs((radians * 180.0) / Math.PI);
    if (angle > 180.0) {
        angle = 360.0 - angle;
    }
    return angle;
}

// Angle of segment a→b from true vertical, in degrees (image coords: y grows downward).
function angleFromVertical(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.abs(Math.atan2(dx, -dy) * 180 / Math.PI);
}

const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;

// Chooses the camera-facing side per frame from MediaPipe visibility scores.
// EMA + hysteresis keep the choice stable so it can't flip in the middle of a rep.
const sidePicker = (() => {
    const IDX = {
        left:  { shoulder: 11, hip: 23, knee: 25, ankle: 27 },
        right: { shoulder: 12, hip: 24, knee: 26, ankle: 28 }
    };
    const ALPHA = 0.2;      // visibility smoothing (higher = snappier)
    const MARGIN = 0.15;    // other side must beat current by this to switch (anti-flicker)
    let emaL = null, emaR = null, locked = null;

    const vis = (lm, s) => {
        const j = IDX[s];
        return ((lm[j.shoulder]?.visibility ?? 0) + (lm[j.hip]?.visibility ?? 0) +
                (lm[j.knee]?.visibility ?? 0) + (lm[j.ankle]?.visibility ?? 0)) / 4;
    };

    function pick(lm) {
        const vL = vis(lm, 'left'), vR = vis(lm, 'right');
        emaL = emaL === null ? vL : ALPHA * vL + (1 - ALPHA) * emaL;
        emaR = emaR === null ? vR : ALPHA * vR + (1 - ALPHA) * emaR;

        if (locked === null)                                   locked = emaR >= emaL ? 'right' : 'left';
        else if (locked === 'right' && emaL > emaR + MARGIN)   locked = 'left';
        else if (locked === 'left'  && emaR > emaL + MARGIN)   locked = 'right';

        const j = IDX[locked];
        return {
            side: locked,
            conf: locked === 'right' ? vR : vL,   // instantaneous confidence of the chosen side
            shoulder: lm[j.shoulder],
            hip:      lm[j.hip],
            knee:     lm[j.knee],
            ankle:    lm[j.ankle]
        };
    }

    return { pick, reset: () => { emaL = emaR = null; locked = null; } };
})();

// --- 2. MEDIAPIPE INITIALIZATION (one graph per video) ---
function createPose(myRun) {
    const p = new Pose({locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`});
    p.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });
    // Closure over myRun: results from a superseded graph can never paint.
    p.onResults((results) => {
        if (myRun !== runId) return;
        onPoseResults(results);
    });
    return p;
}

// --- 3. THE FRAME RENDERING LOOP (Replaces OpenCV) ---
function onPoseResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Draw the frame we captured ourselves — never MediaPipe's internal surface
    canvasCtx.drawImage(frameBuffer, 0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
        // Draw the skeleton
        drawConnectors(canvasCtx, results.poseLandmarks, POSE_CONNECTIONS, {color: '#ffffff', lineWidth: 2});
        drawLandmarks(canvasCtx, results.poseLandmarks, {color: '#3b82f6', lineWidth: 2, radius: 3});

        const joints = sidePicker.pick(results.poseLandmarks);   // pick the visible side ONCE

        if (isCounting) {
            const count = window.currentExercise.update(joints, videoElement.currentTime);
            if (count !== reps) { reps = count; repCountDisplay.innerText = reps; }
        }

        // Live on-canvas angle readout, on the camera-facing knee
        const { hip, knee, ankle, conf } = joints;
        if (conf >= 0.5 && hip && knee && ankle) {
            const angle = calculateAngle(hip, knee, ankle);
            canvasCtx.font = "24px Arial";
            canvasCtx.fillStyle = "white";
            canvasCtx.fillText(Math.round(180 - angle) + "°",
                knee.x * canvasElement.width + 15, knee.y * canvasElement.height);
        }
    }
    canvasCtx.restore();
}

function finishSession() {
    document.getElementById('ptReport').innerHTML = window.currentExercise.finish();
}

// --- 4. VIDEO UPLOAD & PROCESSING TRIGGER ---
document.getElementById('uploadForm').addEventListener('submit', async function(event) {
    event.preventDefault();

    const fileInput = document.getElementById('videoInput');
    const file = fileInput.files[0];
    if (!file) return;

    if (!window.currentExercise) {
        alert('Exercise module failed to load. Please refresh the page.');
        return;
    }

    window.currentExercise.readProfile();
    // New run: invalidate any loop still running from a previous video
    const myRun = ++runId;

    // Tear down the old graph. This is what actually wipes the smoothing
    // filter and the tracker's lock on the previous person.
    if (pose) { pose.close(); pose = null; }

    // Reset all per-video state
    reps = 0;
    window.currentExercise.reset();
    sidePicker.reset();
    const rep = document.getElementById('ptReport');
    if (rep) rep.innerHTML = '';
    isCounting = false;          // stay disarmed through the transition
    repCountDisplay.innerText = reps;

    // Blank the canvas and drop the old blob before anything can repaint.
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    if (videoElement.src) URL.revokeObjectURL(videoElement.src);

    // Keep the canvas hidden behind the spinner during the switch,
    // so the previous video's last frame never flashes.
    document.getElementById('loading').style.display = 'flex';
    document.getElementById('results').style.display = 'none';

    const videoURL = URL.createObjectURL(file);
    videoElement.src = videoURL;
    videoElement.muted = true;

    videoElement.onloadedmetadata = () => {
        if (myRun !== runId) return;
        canvasElement.width  = frameBuffer.width  = videoElement.videoWidth;
        canvasElement.height = frameBuffer.height = videoElement.videoHeight;
    };

    videoElement.onloadeddata = async () => {
        if (myRun !== runId) return;

        pose = createPose(myRun);
        await pose.initialize();          // load WASM before we reveal anything
        if (myRun !== runId) return;

        // Fresh graph has no temporal state, so this is only about painting
        // a correct first frame. Two is plenty.
        await sendFrame(myRun);
        await sendFrame(myRun);
        if (myRun !== runId) return;

        document.getElementById('loading').style.display = 'none';
        document.getElementById('results').style.display = '';
        isCounting = true;

        videoElement.onended = () => {
            if (myRun !== runId) return;
            isCounting = false;
            finishSession();
        };

        videoElement.play();
        processVideo(myRun);
    };
});

// Continuously send frames to MediaPipe while the video plays
async function processVideo(myRun) {
    if (myRun !== runId) return;   // stale loop from an old video — stop
    if (!videoElement.paused && !videoElement.ended) {
        await sendFrame(myRun);
        if (myRun === runId) {
            requestAnimationFrame(() => processVideo(myRun));
        }
    }
}
