// Thigh (femur) angle vs the horizontal floor, from the side.
// +90 ≈ standing (thigh vertical), 0 = thigh flat (parallel), negative = hips below knee.
// This is HIP DEPTH — how low the hips drop — and it's independent of knee bend.
function thighToHorizontal(hip, knee) {
    const dx = hip.x - knee.x;
    const dy = knee.y - hip.y;   // image coords: >0 when the hip is ABOVE the knee
    return Math.atan2(dy, Math.abs(dx)) * 180 / Math.PI;
}
// Phrase a thigh-to-floor angle relative to the parallel line.
const parallelPhrase = deg => {
    const a = Math.round(Math.abs(deg));
    if (deg <= 5 && deg >= -5) return 'right at parallel';
    return deg > 0 ? `${a}° above parallel` : `${a}° below parallel`;
};

// Patient-declared goals/accommodations — the seed of the future `prescription` object.
// This NEVER changes what's measured; it only changes what the measurement is judged against.
const profile = {
    depthGoal: null,      // target bottom knee angle (deg); null = standard parallel test
    depthGoalNote: '',    // documented reason, surfaced in the report
    hipDepthGoal: null,   // thigh-to-floor target; LOWER = deeper. null = default bands
    expectLean: false     // true = forward lean is expected, don't flag as a mobility issue
};

const useDepthGoalInput = document.getElementById('useDepthGoal');
const depthGoalInput    = document.getElementById('depthGoal');
const depthGoalVal      = document.getElementById('depthGoalVal');
const depthNoteInput    = document.getElementById('depthNote');
const expectLeanInput   = document.getElementById('expectLean');
const useHipGoalInput = document.getElementById('useHipGoal');
const hipGoalInput    = document.getElementById('hipGoal');
const hipGoalVal      = document.getElementById('hipGoalVal');

useHipGoalInput.addEventListener('change', () => { hipGoalInput.disabled = !useHipGoalInput.checked; });
hipGoalInput.addEventListener('input', () => {
    const v = Number(hipGoalInput.value);
    hipGoalVal.textContent = Math.abs(v) <= 5 ? 'right at parallel'
        : v > 0 ? `${v}° above parallel` : `${Math.abs(v)}° below parallel`;
});

useDepthGoalInput.addEventListener('change', () => { depthGoalInput.disabled = !useDepthGoalInput.checked; });
depthGoalInput.addEventListener('input', () => { depthGoalVal.textContent = depthGoalInput.value + '°'; });

// Captures the SHAPE of each rep as scalar features. All thresholds tunable.
const squatCapture = (() => {
    const DESCEND = 150, TOP = 158;     // enter a rep on the way down; complete near standing
    let inRep = false;
    let minKnee, trunkAtBottom, shinAtBottom, minThigh, startT, bottomT;
    let sessionPeakExt = 0;             // straightest knee at standing → top-extension proxy
    const reps = [];

    function update(joints, t) {
        const { hip, knee, ankle, shoulder, conf } = joints;
        if (!hip || !knee || !ankle || !shoulder) return reps.length;
        if (conf < 0.5) return reps.length;

        const kneeAngle = calculateAngle(hip, knee, ankle);
        const trunk = angleFromVertical(hip, shoulder);   // 0 = upright torso
        const shin  = angleFromVertical(ankle, knee);     // 0 = vertical shin
        const thigh = thighToHorizontal(hip, knee);       // hip depth: thigh angle vs floor

        if (kneeAngle > sessionPeakExt) sessionPeakExt = kneeAngle;

        if (!inRep && kneeAngle < DESCEND) {              // rep begins
            inRep = true;
            minKnee = kneeAngle; trunkAtBottom = trunk; shinAtBottom = shin;
            minThigh = thigh; startT = bottomT = t;
        } else if (inRep) {
            if (kneeAngle < minKnee) {                    // new bottom → snapshot trunk & shin HERE
                minKnee = kneeAngle; bottomT = t;
                trunkAtBottom = trunk; shinAtBottom = shin;
            }
            if (thigh < minThigh) minThigh = thigh;       // deepest hip position of the rep
            if (kneeAngle > TOP) {                         // rep complete on return to standing
                reps.push({
                    depth: minKnee,
                    hipDepth: minThigh,                    // how low the hips dropped (thigh vs floor)
                    trunkLean: trunkAtBottom,
                    trunkShinGap: trunkAtBottom - shinAtBottom,   // the root-cause signal
                    descent: Math.max(0, bottomT - startT)
                });
                inRep = false;
            }
        }
        return reps.length;
    }

    return {
        update,
        reset: () => { inRep = false; reps.length = 0; sessionPeakExt = 0; },
        getReps: () => reps.slice(),
        getPeakExtension: () => sessionPeakExt
    };
})();

function buildReport() {
    const reps = squatCapture.getReps();
    if (!reps.length) {
        return `<div class="feedback-message feedback-warning">⚠️ No full squats detected.
                Film side-on with your whole body in frame, and stand fully upright between reps.</div>`;
    }

    // Knee flexion = 180 − interior joint angle. 0° = straight leg, higher = deeper bend.
    // Clinical ROM convention, and it matches how the patient reads the slider.
    const FLEX      = r => 180 - r.depth;
    const flexes    = reps.map(FLEX);
    const avgFlex   = mean(flexes);
    const bestFlex  = Math.max(...flexes);

    // HIP DEPTH — thigh angle vs the floor at the lowest point. Independent of knee bend.
    // >0 = hips above parallel (shallower), 0 = at parallel, <0 = hips below knee (deeper).
    const hipDepths    = reps.map(r => r.hipDepth);
    const avgHipDepth  = mean(hipDepths);
    const bestHipDepth = Math.min(...hipDepths);          // most negative = deepest hips
    const PARALLEL_TOL = 5;                                // within 5° of flat counts as parallel
    const parallelCt   = hipDepths.filter(h => h <= PARALLEL_TOL).length;

    const avgGap     = mean(reps.map(r => r.trunkShinGap));
    const avgDescent = mean(reps.map(r => r.descent));
    const topFlex    = 180 - squatCapture.getPeakExtension();

    const half = Math.floor(reps.length / 2);
    const fatigueDrop = half >= 1
        ? mean(flexes.slice(0, half)) - mean(flexes.slice(reps.length - half))  // +ve = shallower late
        : 0;

    // BASELINE — reported in flexion, the SAME unit the goal is judged in.
    const baseline = `You completed <b>${reps.length}</b> ${reps.length === 1 ? 'rep' : 'reps'}.
        <br><b>Knee bend:</b> averaged ${Math.round(avgFlex)}° (deepest ${Math.round(bestFlex)}°) — how much the knee joint folds.
        <br><b>Hip depth:</b> hips dropped to ${parallelPhrase(avgHipDepth)} on average (best ${parallelPhrase(bestHipDepth)}) — how low you actually sit. ${parallelCt}/${reps.length} reps reached parallel.`;

    // Documented accommodations — shows the *scoring* was adjusted, not the data.
    const accommParts = [];
    if (profile.depthGoal != null)
        accommParts.push(`knee-bend goal ${profile.depthGoal}°${profile.depthGoalNote ? ` (${profile.depthGoalNote})` : ''}`);
    if (profile.hipDepthGoal != null) {
        const hp = profile.hipDepthGoal;
        const phrase = Math.abs(hp) <= 5 ? 'parallel' : hp > 0 ? `${hp}° above parallel` : `${Math.abs(hp)}° below parallel`;
        accommParts.push(`hip-depth goal ${phrase}`);
    }
    if (profile.expectLean) accommParts.push('forward lean expected');
    const accommHtml = accommParts.length
        ? `<div class="accomm-note">⚙️ Evaluated against your settings: ${accommParts.join('; ')}. Your measured numbers above are unchanged — only the goals they're judged against.</div>`
        : '';

    // OBSERVATIONS
    const obs = [];

    // Depth is measured identically (knee flexion) in BOTH branches — only the target differs.
    if (profile.depthGoal != null) {
        const G = profile.depthGoal, TOL = 8;
        const hitGoal  = reps.filter(r => FLEX(r) >= G - TOL).length;   // reached the flexion target
        const wellPast = reps.filter(r => FLEX(r) >= G + 20).length;    // notably deeper than goal
        if (hitGoal === reps.length)
            obs.push(['success', `Hit your ${G}° knee-bend goal on every rep (measured avg ${Math.round(avgFlex)}°).`]);
        else if (hitGoal > 0)
            obs.push(['warning', `Reached your ${G}° goal on ${hitGoal}/${reps.length} reps (measured avg ${Math.round(avgFlex)}°) — the rest stopped a little short.`]);
        else
            obs.push(['warning', `Didn't reach your ${G}° goal (measured avg ${Math.round(avgFlex)}°) — not quite hitting your target yet.`]);
        if (wellPast > 0)
            obs.push(['warning', `${wellPast} rep${wellPast > 1 ? 's' : ''} bent well past your ${G}° mark — if deeper is the range that bothers your knee, ease off there.`]);
    } else {
        if (avgFlex >= 100)
            obs.push(['success', `Good depth — averaging ${Math.round(avgFlex)}° of knee bend (a deep squat).`]);
        else if (avgFlex >= 70)
            obs.push(['success', `Functional depth — averaging ${Math.round(avgFlex)}° of knee bend (about a right angle).`]);
        else
            obs.push(['warning', `Partial depth — averaging ${Math.round(avgFlex)}° of knee bend; limited range so far.`]);
    }

    // HIP DEPTH — judged against a personal goal if set; otherwise default bands.
    if (profile.hipDepthGoal != null) {
        const H = profile.hipDepthGoal, HTOL = 5;
        const hitHip = hipDepths.filter(h => h <= H + HTOL).length;   // reached target (lower = deeper)
        const deeper = hipDepths.filter(h => h <= H - 20).length;     // well past target
        const goalPhrase = Math.abs(H) <= 5 ? 'parallel' : H > 0 ? `${H}° above parallel` : `${Math.abs(H)}° below parallel`;
        if (hitHip === reps.length)
            obs.push(['success', `Hit your hip-depth goal (${goalPhrase}) on every rep — hips averaged ${parallelPhrase(avgHipDepth)}.`]);
        else if (hitHip > 0)
            obs.push(['warning', `Reached your hip-depth goal on ${hitHip}/${reps.length} reps — hips averaged ${parallelPhrase(avgHipDepth)}.`]);
        else
            obs.push(['warning', `Hips didn't reach your goal (${goalPhrase}) — averaged ${parallelPhrase(avgHipDepth)}.`]);
        if (deeper > 0)
            obs.push(['warning', `${deeper} rep${deeper > 1 ? 's' : ''} dropped well below your target — ease off if that range aggravates anything.`]);
    } else {
        if (avgHipDepth <= -10)
            obs.push(['success', `Deep hips — sitting ${parallelPhrase(avgHipDepth)} on average.`]);
        else if (avgHipDepth <= PARALLEL_TOL)
            obs.push(['success', `Hips reached parallel — thigh to knee level (${parallelCt}/${reps.length} reps).`]);
        else if (avgHipDepth <= 20)
            obs.push(['warning', `Hips stopped ${parallelPhrase(avgHipDepth)} on average — a little high of parallel.`]);
        else
            obs.push(['warning', `Hips stayed ${parallelPhrase(avgHipDepth)} — shallow; the thigh isn't dropping to flat.`]);
    }

    if (topFlex <= 15)
        obs.push(['success', `Standing to near-full extension between reps${topFlex <= 3 ? ' (fully locked out)' : ` (~${Math.round(topFlex)}° of bend remaining)`}.`]);
    else
        obs.push(['warning', `Not fully straightening at the top — about ${Math.round(topFlex)}° of bend remaining between reps.`]);

    if (avgDescent >= 1.0)
        obs.push(['success', `Controlled lowering — about ${avgDescent.toFixed(1)}s to descend each rep.`]);
    else
        obs.push(['warning', `Quick descent — only ${avgDescent.toFixed(1)}s down; dropping rather than lowering under control.`]);

    // ASSESSMENT (the "why")
    const assess = [];
    if (avgGap > 22) {
        if (profile.expectLean)   // was profile.expectation — that key doesn't exist, so this never fired
            assess.push(`Forward lean present at the bottom (trunk–shin gap ~${Math.round(avgGap)}°). You've noted this is expected for you, so it's not flagged as a mobility problem — just keep it consistent and pain-free.`);
        else
            assess.push(`Your torso folds forward while the shins stay fairly vertical at the bottom (trunk–shin gap ~${Math.round(avgGap)}°). This most often points to <b>limited ankle mobility</b> — the knee can't travel forward enough, so the chest drops to compensate. A hip-dominant pattern can look the same.`);
    } else if (avgGap < -10)
        assess.push(`Knees travel well forward with an upright torso — a knee-dominant pattern. Fine for most people, but worth watching if you get pain at the front of the knee.`);
    else
        assess.push(`Trunk and shin move in balance — no obvious ankle or hip compensation from this angle.`);

    // KEY divergence: lots of knee bend but hips still high → knees travel forward, hips don't sit.
    if (profile.hipDepthGoal == null && avgFlex >= 90 && avgHipDepth > 20)
        assess.push(`Your knees bend plenty (avg ${Math.round(avgFlex)}°) but your hips stay high (${parallelPhrase(avgHipDepth)}) — the knees are travelling forward rather than the hips sitting down and back. The joint <i>looks</i> like a deep squat while the hips aren't actually dropping far. If depth is the goal, cue "hips back and down," not just "bend more."`);

    if (fatigueDrop > 8)
        assess.push(`Depth shrank about ${Math.round(fatigueDrop)}° across the set — form is breaking down under fatigue toward the end.`);

    // PLAN (top 1–2 only)
    const plan = [];
    if (avgGap > 22 && !profile.expectLean)
        plan.push(`Work ankle mobility (calf stretches, knee-to-wall drill) and try a small heel lift — a folded towel under the heels — so the knees can travel forward and the chest can stay tall.`);
    // No goal set: only nudge deeper when the bend is genuinely partial.
    if (plan.length < 2 && profile.depthGoal == null && avgFlex < 70 && avgGap <= 22)
        plan.push(`Sit deeper — lower onto a box or bench at the height you're aiming for and tap it each rep for a consistent depth target.`);
    // Knee bends fine but hips high → the sit-back cue, not a deeper-bend cue.
    if (plan.length < 2 && profile.depthGoal == null && profile.hipDepthGoal == null && avgHipDepth > 20 && avgFlex >= 70)
        plan.push(`Sit the hips down and back — aim to bring your thighs level with your knees. A box or chair at parallel height gives you something to tap for a consistent target.`);
    
    // Goal set but not consistently reached.
    if (plan.length < 2 && profile.depthGoal != null &&
        reps.filter(r => FLEX(r) >= profile.depthGoal - 8).length < reps.length)
        plan.push(`Aim to reach your ${profile.depthGoal}° knee-bend target on every rep — a box or chair at that height gives you something to tap for consistency.`);
    if (plan.length < 2 && profile.hipDepthGoal != null &&
        hipDepths.filter(h => h <= profile.hipDepthGoal + 5).length < reps.length)
        plan.push(`Aim to sit your hips down to your target on each rep — a box or chair at that height gives you something to tap for consistency.`);
    if (plan.length < 2 && avgDescent < 1.0)
        plan.push(`Slow the lowering — count "three down, one up" so the muscle controls the movement, not gravity.`);
    if (plan.length < 2 && fatigueDrop > 8)
        plan.push(`Stop the set once depth starts shrinking — a few clean reps beat many sloppy ones.`);
    if (plan.length < 2 && topFlex > 15)
        plan.push(`Finish each rep standing all the way tall before starting the next.`);
    if (!plan.length)
        plan.push(`Nothing major to change — keep this exact form and add a rep or two next session.`);

    const cues = [
        'Feet shoulder-width, toes turned slightly out.',
        'Push the hips back like sitting into a chair.',
        'Chest tall, weight through the mid-foot and heels.',
        'Lower under control, then drive up through the floor.'
    ];

    const msgs = a => a.map(([t, m]) => `<div class="feedback-message feedback-${t}" style="margin-top:10px;">${m}</div>`).join('');
    const lis  = a => a.map(x => `<li>${x}</li>`).join('');

    return `
        <div class="metric-box" style="display:block;">
            <span class="metric-label">📋 Baseline</span>
            <p style="margin:8px 0 0; color:#334155; font-weight:400;">${baseline}</p>
        </div>
        ${accommHtml}
        <div class="report-section"><h4>🟦 Clinical Cues</h4><ul class="report-list">${lis(cues)}</ul></div>
        <div class="report-section"><h4>👀 What I Observed</h4>${msgs(obs)}</div>
        <div class="report-section"><h4>🩺 Assessment</h4>${assess.map(a => `<p class="assess-line">${a}</p>`).join('')}</div>
        <div class="report-section"><h4>🛠️ Your Plan — Focus On</h4><ul class="report-list">${lis(plan)}</ul></div>
        <p class="report-note">Movement feedback only, not a medical diagnosis. <b>Knee bend</b> is how much the knee
        joint folds; <b>hip depth</b> is how low your hips actually sit, measured against the parallel line. They're
        different — you can bend the knee a lot without the hips dropping far if the knees travel forward, which is why
        both are shown. The two goal sliders set knee-bend and hip-depth targets independently. A side view also can't assess
        knee cave or left/right symmetry.</p>`;
    
}

function readProfile() {
    profile.depthGoal     = useDepthGoalInput.checked ? Number(depthGoalInput.value) : null;
    profile.depthGoalNote = depthNoteInput.value.trim();
    profile.expectLean    = expectLeanInput.checked;
    profile.hipDepthGoal  = useHipGoalInput.checked ? Number(hipGoalInput.value) : null;
}

// Register this exercise under the generic name the shell calls.
window.currentExercise = {
    update:      (joints, t) => squatCapture.update(joints, t),
    reset:       () => squatCapture.reset(),
    finish:      buildReport,
    readProfile: readProfile
};