// Desmos API 1.6

// Utilities
async function loadImage(src) {
    return new Promise((res, rej) => {
        const image = new Image();
        image.onload = _ => res(image);
        image.src = src;
    });
}

function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(_ => URL.revokeObjectURL(url), 1000);
}

async function createVideo(frames, width, height, settings) {
    // I could not find a native method of synthesizing frames with constant spacing
    // Instead, as a workaround, blit frames to a canvas in real time and record as a video

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });

    const stream = canvas.captureStream();
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=h264" });

    const promise = new Promise((res, rej) => {
        const chunks = [];
        recorder.ondataavailable = event => chunks.push(event.data);
        recorder.onstop = _ => res(new Blob(chunks, { type: "video/webm" }));
    });

    const images = await Promise.all(frames.map(src => loadImage(src)));

    recorder.start();

    const delay = 1000 * settings.duration / settings.frames;
    for (let i = 0; i < images.length; i++)
        setTimeout(_ => ctx.drawImage(images[i], 0, 0), delay * i);
    setTimeout(_ => recorder.stop(), delay * images.length);

    return promise;
}


// Desmos utilities
async function evaluate(calc, latex) {
    // A helper expression with a single number will not evaluate,
    // hack around by adding 0
    const expression = calc.HelperExpression({ latex: latex + "+0" });
    return new Promise((res, rej) => expression.observe("numericValue", _ => res(expression.numericValue)));
}

async function screenshot(calc, opts) {
    return new Promise((res, rej) => {
        calc.asyncScreenshot(opts, dataurl => res(dataurl));
    });
}


bounds = {};

async function setup(calc) {
    const expressions = new Set(calc.getExpressions().map(expr => expr.id));

    calc.setExpressions([
        // folder
        { id: "bounds", hidden: false, type: "folder" },

        // draggable points and rectangle
        { id: "bounds x1y1", secret: true, color: calc.colors.GREEN, latex: "\\left(B_{x1},B_{y1}\\right)" },
        { id: "bounds x2y2", secret: true, color: calc.colors.GREEN, latex: "\\left(B_{x2},B_{y2}\\right)" },
        { id: "bounds rect", secret: true, color: calc.colors.GREEN, fill: false, latex: "\\operatorname{polygon}\\left(\\left[\\left(B_{x1},B_{y1}\\right),\\left(B_{x1},B_{y2}\\right),\\left(B_{x2},B_{y2}\\right),\\left(B_{x2},B_{y1}\\right)\\right]\\right)" },

        // controls
        { id: "bounds animate", secret: true, latex: "a_{nimate}=0" },
        { id: "bounds start action", secret: false, latex: "a_{nimate} \\to a_{nimate}+1" },
    ]);

    if (!expressions.has("bounds x1"))
    // edges
        calc.setExpressions([
        { id: "bounds x1", secret: true, latex: "B_{x1}=-9.6" },
        { id: "bounds x2", secret: true, latex: "B_{x2}= 9.6" },
        { id: "bounds y1", secret: true, latex: "B_{y1}=-5.4" },
        { id: "bounds y2", secret: true, latex: "B_{y2}= 5.4" },
    ]);

    if (!expressions.has("bounds time"))
        calc.setExpression({ id: "bounds time", latex: "t_{ime}=0", sliderBounds: { min: "0", max: "1" } });


    // Modify state to place all expressions inside of folder
    const state = calc.getState();

    for (const expression of state.expressions.list) {
        if (expression.id === "bounds") // folder
            expression.title = "Bounds";

        else if (expression.id.startsWith("bounds"))
            expression.folderId = "bounds";
    }

    calc.setState(state);


    // Update helper expressions
    bounds.x1 = calc.HelperExpression({ latex: `B_{x1}` });
    bounds.x2 = calc.HelperExpression({ latex: `B_{x2}` });
    bounds.y1 = calc.HelperExpression({ latex: `B_{y1}` });
    bounds.y2 = calc.HelperExpression({ latex: `B_{y2}` });

    await Promise.all([
        new Promise((res, rej) => bounds.x1.observe("numericValue", _ => res())),
        new Promise((res, rej) => bounds.x2.observe("numericValue", _ => res())),
        new Promise((res, rej) => bounds.y1.observe("numericValue", _ => res())),
        new Promise((res, rej) => bounds.y2.observe("numericValue", _ => res())),
    ]);
}

function getMathBounds() {
    return {
        left: Math.min(bounds.x1.numericValue, bounds.x2.numericValue),
        right: Math.max(bounds.x1.numericValue, bounds.x2.numericValue),
        bottom: Math.min(bounds.y1.numericValue, bounds.y2.numericValue),
        top: Math.max(bounds.y1.numericValue, bounds.y2.numericValue),
    };
}

async function captureFrames(calc, settings, opts) {
    const expressions = calc.getExpressions();
    const folderHidden = expressions.find(expr => expr.id === "bounds").hidden;
    const { showGrid, showXAxis, showYAxis } = calc.settings;

    calc.updateSettings({ showGrid: false, showXAxis: false, showYAxis: false });
    calc.setExpression({ id: "bounds", hidden: true });

    const slider = expressions.find(expr => expr.id === "bounds time");
    const min = await evaluate(calc, slider.sliderBounds.min);
    const max = await evaluate(calc, slider.sliderBounds.max);

    const frames = [];
    for (let i = 0; i < settings.frames; i++) {
        const time = min + (i / (settings.frames - 1)) * (max - min);
        calc.setExpression({ id: "bounds time", latex: `t_{ime}=${time}` });
        frames.push(await screenshot(calc, opts));
    }

    calc.setExpression({ id: "bounds", hidden: folderHidden });
    calc.updateSettings({ showGrid, showXAxis, showYAxis });

    return frames;
}

async function render(calc, settings) {
    const bounds = getMathBounds();
    const opts = {
        width: Math.floor((bounds.right - bounds.left) * settings.resolution),
        height: Math.floor((bounds.top - bounds.bottom) * settings.resolution),
        mode: "stretch",
        mathBounds: bounds
    };

    calc.setExpression({ id: "bounds start action", secret: true });

    const frames = await captureFrames(calc, settings, opts);
    const blob = await createVideo(frames, opts.width, opts.height, settings);
    downloadBlob(blob, "desmos.webm");

    calc.setExpression({ id: "bounds start action", secret: false });
}

(async() => {
    const settings = {
        duration: 5, // duration of rendered animation in seconds
        frames: 200, // number of frames in rendered animation
        // Note: May not work well with high framerates

        resolution: 10, // pixels per desmos unit
        // For example, if the selected bounds span from x=-40 to x=70,
        // a resolution of 10 will render an animation 1100px wide
    };

    await setup(Calc);

    const animate = Calc.HelperExpression({ latex: "a_{nimate}" });
    animate.observe("numericValue", function() {
        if (animate.numericValue !== 0)
            render(Calc, settings);
    });
})();