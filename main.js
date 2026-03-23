

import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import {Inspector} from 'three/addons/inspector/Inspector.js';
import {gaussianBlur} from 'three/addons/tsl/display/GaussianBlurNode.js';

// ----------------------------------------------------------------------
// PARAMETERS
// ----------------------------------------------------------------------
const PARAMS = {}
PARAMS.autoUpdateReferenceImage = true
    
// ----------------------------------------------------------------------
// VIDEO SOURCE SETUP
// ----------------------------------------------------------------------

// Video object initialization
const videoObject = document.createElement('video');
videoObject.autoplay = true;
videoObject.playsInline = true;

// Get video sources
const videoConstraints = {
    video: {
        // width: { ideal: 4096 }, height: { ideal: 2160 }, 
        width: { ideal: 640 },//height: 720,
        facingMode: "environment" // try to use rear camera on mobile devices
    },
    // width: 1024,
}
const stream = await navigator.mediaDevices.getUserMedia(videoConstraints);
videoObject.srcObject = stream;

// Playing status
let videoPlaying = false
videoObject.addEventListener("playing", function() {
    videoPlaying = true;
    console.log("video playing!");
}, true);

videoObject.play();

// Wait for the video to start
console.log("Waiting for video metadata...");
await new Promise((resolve) => { videoObject.onloadedmetadata = () => { resolve(); }; });
console.log("Video metadata loaded:", videoObject.videoWidth, "x", videoObject.videoHeight);
await new Promise((resolve) => { videoObject.onplaying = () => { resolve(); }; });

// Init the video texture object
const videoTexture = new THREE.VideoTexture(videoObject);
videoTexture.colorSpace = THREE.SRGBColorSpace;

// ----------------------------------------------------------------------
// SETUP THREEJS RENDERER
// ----------------------------------------------------------------------

// Scene & Camera (Orthographic for 2D feel)
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 10); // Left, Right, Top, Bottom, Near, Far
camera.position.z = 1; // Position camera slightly away from origin

// WebGPU Renderer Setup
const renderer = new THREE.WebGPURenderer({ 
    antialias: false,
    // forceWebGL: true, //////////////////////////////////////////////////////////////////////////////////
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// Init Inspector GUI
renderer.inspector = new Inspector();

// Mandatory initialization for WebGPU
document.body.appendChild(renderer.domElement);
await renderer.init(); 

// Handle video & window size changes
function resizeRenderer() {
    // Fit renderer in window while preserving aspect ratio
    const videoAspect = videoObject.videoWidth / videoObject.videoHeight;
    if (window.innerWidth > videoAspect * window.innerHeight) {
        renderer.setSize(window.innerHeight * videoAspect, window.innerHeight);
    } else {
        renderer.setSize(window.innerWidth, window.innerWidth / videoAspect);
    }
    // Update camera to match video size
    camera.right = videoObject.videoWidth;
    camera.top = videoObject.videoHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeRenderer);
resizeRenderer() // apply video size at start


// ----------------------------------------------------------------------
// IMAGE VIEWER SETUP
// ----------------------------------------------------------------------

// Create a Node Material for the image viewer
const imagePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(1,1).translate(0.5,0.5,0),  // default plane (x,y) in [0,1] range
    new THREE.MeshBasicNodeMaterial()
);
scene.add(imagePlane);

// Handle video & window size changes
function resizeImageViewer() {
    imagePlane.scale.x = videoObject.videoWidth;
    imagePlane.scale.y = videoObject.videoHeight;
}
window.addEventListener('resize', resizeImageViewer);
resizeImageViewer()

async function setImageViewerTexture(tex) {
    // console.log("Setting image viewer texture:", tex);
    if (tex instanceof THREE.Node) imagePlane.material.colorNode = tex;
    else if (tex instanceof THREE.Texture) imagePlane.material.colorNode = TSL.texture(tex);
    else console.error("setImageViewerTexture: Unsupported texture type:", tex);
    imagePlane.material.needsUpdate = true
};

await setImageViewerTexture(videoTexture);



// ----------------------------------------------------------------------
// IMAGE PRE-PROCESSING SETUP
// ----------------------------------------------------------------------

const blur = (img, blur_sz) => {
    const blur_ratio = 3.0;
    let tex = TSL.convertToTexture(img,videoObject.videoWidth,videoObject.videoHeight);
    const dx = TSL.vec2(1.0,0.0).div( videoObject.videoWidth ).toConst();
    const dy = TSL.vec2(0.0,1.0).div( videoObject.videoHeight ).toConst();
    let out = TSL.float(0.0) ;
    // X-Pass
    let sum = 0.0 ;
    for (let sx=0;sx<blur_sz;sx++) {
        const shift = sx-(blur_sz-1.0)/2.0
        const val = Math.exp((0.0-(blur_ratio*shift/blur_sz)**2.0))
        out = out.add(TSL.texture(tex,TSL.uv().add(dx.mul(shift))).mul(val))
        sum += val ;
    }
    out = out.div(sum);
    // Y-Pass
    tex = TSL.convertToTexture(out,videoObject.videoWidth,videoObject.videoHeight);
    for (let sy=0;sy<blur_sz;sy++) {
        const shift = sy-(blur_sz-1.0)/2.0
        const val = Math.exp((0.0-(blur_ratio*shift/blur_sz)**2.0))
        out = out.add(TSL.texture(tex,TSL.uv().add(dy.mul(shift))).mul(val))
    }
    out = out.div(sum);
    return out
}

const preprocessImage = (tex) => {
    if (!(tex instanceof THREE.Node)) tex = TSL.texture(tex);
    tex = tex.dot(TSL.vec4(1.0/3.0, 1.0/3.0, 1.0/3.0,0.0)).toFloat(); // gray level
    tex = blur(tex,3.0)
    return TSL.convertToTexture(tex,videoObject.videoWidth,videoObject.videoHeight);
}

const yuv2rgb = (y,u,v) => {
    const r = y.add(v);
    const g = y.sub(u).sub(v);
    const b = y.add(u);
    return TSL.vec3(r,g,b);
}

const vec2rgbY = TSL.uniform(0.0)
const vec2rgbMul = TSL.uniform(0.0)
const vec2rgb = (vec) => {
    vec = vec.mul(vec2rgbMul.exp())
    return yuv2rgb(vec2rgbY,vec.x,vec.y)
}

function videoFrame() {
    const tex = new THREE.VideoFrameTexture();
    tex.colorSpace = THREE.SRGBColorSpace; // required for correct color handling in TSL
    tex.setFrame(new VideoFrame(videoObject)); // initialize the frame data
    const img = preprocessImage(tex);
    return [tex, img];
}

function setVideoFrame(dst) {
    const frame = new VideoFrame(videoObject);
    dst.source.data.close();
    dst.setFrame(frame);
}

// ----------------------------------------------------------------------
// DIC SETUP
// ----------------------------------------------------------------------

PARAMS.DIC = {
    subsetSize: 25,
    detHessBias: -15,
}

// Current Image
const [currentTexture, currentImage] = videoFrame()
// // const currentTexture = await videoFrame()
function setCurrentImage() { setVideoFrame(currentTexture) }
setCurrentImage();
await setImageViewerTexture(currentImage);

// Reference Image
const [referenceTexture, referenceImage] = videoFrame()
function setReferenceImage() { setVideoFrame(referenceTexture) }
setReferenceImage();

// Difference Image
const diffImage = currentImage.sub(referenceImage.sample(TSL.uv()))
const clrDiffImage = diffImage.mul(TSL.vec3(1.0,0.0,-1.0)) // for vizualization only
// await setImageViewerTexture(diffImage);
// await setImageViewerTexture(TSL.blendColor(currentImage,clrDiffImage));

const imageGradient = (img) => {
    const tex = TSL.texture(img);
    const dx = TSL.vec2(1.0,0.0).div( videoObject.videoWidth );
    const dy = TSL.vec2(0.0,1.0).div( videoObject.videoHeight );
    const Ix = tex.sample(TSL.uv().add(dx)).sub( tex.sample(TSL.uv().sub(dx)) ).div(2.0);
    const Iy = tex.sample(TSL.uv().add(dy)).sub( tex.sample(TSL.uv().sub(dy)) ).div(2.0);
    const grad = TSL.vec2(Ix.r,Iy.r);
    return TSL.convertToTexture(grad,videoObject.videoWidth,videoObject.videoHeight);
}
const gradImage = imageGradient(currentImage) ;
const clrGradImage = vec2rgb(gradImage);
// await setImageViewerTexture(clrGradImage);

const displacementImage = TSL.convertToTexture(TSL.vec2(0.0,0.0),videoObject.videoWidth,videoObject.videoHeight);

const blurFcn = (tex,sz) => {return blur(tex,sz);}//{return gaussianBlur(tex,null,sz);}
const detHessBias = TSL.uniform(PARAMS.DIC.detHessBias);
const jacImage = blurFcn(gradImage.mul(diffImage),PARAMS.DIC.subsetSize);
const hessImage = blurFcn(TSL.vec3(
                                gradImage.x.pow(2),
                                gradImage.y.pow(2),
                                gradImage.x.mul(gradImage.y)
                            ),PARAMS.DIC.subsetSize);
const detHessImage = hessImage.x.mul(hessImage.y).sub(hessImage.z.mul(hessImage.z)).add(detHessBias.exp());
const invHessImage = TSL.vec3(
                            hessImage.y,
                            hessImage.x,
                            hessImage.z.negate()
                            ).div(detHessImage);
const flowImage = TSL.vec2(
                        invHessImage.x.mul(jacImage.x).add(invHessImage.z.mul(jacImage.y)),
                        invHessImage.z.mul(jacImage.x).add(invHessImage.y.mul(jacImage.y))
                    ).negate();
const clrFlowImage = TSL.vec4(vec2rgb(flowImage),detHessImage.div(detHessBias.exp()).saturate().div(2));
const blendFlowImage = TSL.blendColor(currentImage.rgb,clrFlowImage) ;



// ----------------------------------------------------------------------
// TRACKING VIZUALIZATION
// ----------------------------------------------------------------------

// const gridStep = 0.05;
// const videoResolution = TSL.vec2( videoObject.videoWidth, videoObject.videoHeight );
// const gridDimCount = Math.floor(2.0/gridStep);
// const gridTotalCount = gridDimCount**2

// const count = gridTotalCount
// const material = new THREE.SpriteNodeMaterial();// { blending: THREE.AdditiveBlending, depthWrite: false } );
// const positionBuffer = TSL.instancedArray( count, 'vec2' );
// const refPositionBuffer = TSL.instancedArray( count, 'vec2' );
// const colorBuffer = TSL.instancedArray( count, 'vec4' );

// material.colorNode = colorBuffer.toAttribute();
// material.scaleNode = TSL.float(10.0);
// material.scaleAttenuation = false;
// const geometry = new THREE.PlaneGeometry( 1, 1 );
// const mesh = new THREE.InstancedMesh( geometry, material, count );
// scene.add( mesh );

// const computeInit = TSL.Fn( () => { // the compute shader
//     // compute position data
//     const idx = TSL.instanceIndex.toFloat();
//     const igrid = TSL.mod(idx,gridDimCount);
//     const jgrid = TSL.floor(idx.div(gridDimCount));
//     const pos = TSL.vec2(jgrid, igrid).mul(gridStep).sub(1.0).add(gridStep/2.0).mul(videoResolution);
//     positionBuffer.element( TSL.instanceIndex ).assign(pos);
//     refPositionBuffer.element( TSL.instanceIndex ).assign(pos);
//     // color data
//     colorBuffer.element( TSL.instanceIndex ).assign( TSL.vec4(1,1,1,1) );
// } )().compute(count);

// renderer.computeAsync( computeInit );

// const flowTexture = TSL.convertToTexture(flowImage,videoObject.videoWidth,videoObject.videoHeight);
// const computeUpdate = TSL.Fn( () => { // the compute shader
//     // compute position data
//     // const refpos = refPositionBuffer.element( TSL.instanceIndex );
//     // const uuvv = (refpos/videoResolution).xy;
//     // const du = TSL.texture(currentImage,TSL.uv()).mul(1.0) ;
//     // const pos = refpos + TSL.texture(flowTexture,uv.xy).xy.mul(10.0) ;
//     // positionBuffer.element( TSL.instanceIndex ).assign(pos);
//     // color data
//     colorBuffer.element( TSL.instanceIndex ).assign( TSL.vec4(TSL.instanceIndex.div(count),1,1,1) );
// } )().compute(count);

// material.colorNode = TSL.Fn( () => {

//     const refpos = refPositionBuffer.toAttribute();
//     const uuvv = refpos.div(videoResolution).xy;
//     const du = TSL.texture(flowTexture,uuvv);
//     // const velocity = velocityBuffer.toAttribute();
//     // const speed = velocity.length();
//     // const colorMix = speed.div( maxSpeed ).smoothstep( 0, 0.5 );
//     // const finalColor = mix( colorA, colorB, colorMix );

//     return TSL.vec4( du.x,du.y,1, 1 );

// } )();

// material.positionNode = TSL.Fn( () => {

//     const refpos = refPositionBuffer.toAttribute();
//     const uv = refpos.div(videoResolution).xy;
//     const du = TSL.texture(flowTexture,uv);
//     // const velocity = velocityBuffer.toAttribute();
//     // const speed = velocity.length();
//     // const colorMix = speed.div( maxSpeed ).smoothstep( 0, 0.5 );
//     // const finalColor = mix( colorA, colorB, colorMix );

//     return refpos.add( du.mul(10.0) );

// } )();

//     computeUpdate = TSL.Fn( () => { // the compute shader
//         const uv0_ref = refPositionBuffer.element( TSL.instanceIndex ).mul(0.5).add(0.5);
//         const position = positionBuffer.element( TSL.instanceIndex );
//         const displacement = TSL.vec2(0.0,0.0).toVar();
//         const clr = TSL.vec4(0.0,0.0,0.0,0.5).toVar();
//         TSL.Loop( N_ITERATIONS , (i) => {
//             // iterative LK
//             // compute flow at current position
//             const uv0_cur = position.add(displacement).mul(0.5).add(0.5);
//             const A = TSL.vec3(0.0,0.0,0.0).toVar(); // [Axx, Ayy, Axy]
//             const b = TSL.vec2(0.0,0.0).toVar(); // [bx, by]
//             TSL.Loop({start:-SUBSET_HALF_SIZE, end:SUBSET_HALF_SIZE}, (sx) => {
//                 TSL.Loop({start:-SUBSET_HALF_SIZE, end:SUBSET_HALF_SIZE}, (sy) => {
//                     const offset = TSL.vec2([TSL.float(sx), TSL.float(sy)]).div( videoResolution );
//                     const uv_ref = uv0_ref.add(offset);
//                     const uv_cur = uv0_cur.add(offset);
//                     const ref = TSL.texture( refTexture, uv_ref ).rgb.toVec3();
//                     const cur = TSL.texture( videoTexture, uv_cur ).rgb.toVec3();
//                     const diff = cur.sub(ref);
//                     const dfdx = TSL.texture( videoTexture, uv_cur.add( TSL.vec2(1.0,0.0).div(videoResolution)) ).rgb.toVec3().sub( cur );
//                     const dfdy = TSL.texture( videoTexture, uv_cur.add( TSL.vec2(0.0,1.0).div(videoResolution)) ).rgb.toVec3().sub( cur );
//                     b.x.addAssign( diff.mul(dfdx).dot(TSL.vec3(1.0,1.0,1.0)) );
//                     b.y.addAssign( diff.mul(dfdy).dot(TSL.vec3(1.0,1.0,1.0)) );
//                     A.x.addAssign( dfdx.mul(dfdx).dot(TSL.vec3(1.0,1.0,1.0)) );
//                     A.y.addAssign( dfdy.mul(dfdy).dot(TSL.vec3(1.0,1.0,1.0)) );
//                     A.z.addAssign( dfdx.mul(dfdy).dot(TSL.vec3(1.0,1.0,1.0)) );
//                     clr.rgb.addAssign( diff.abs().div((2.0*SUBSET_HALF_SIZE+1.0)**2.0) );
//                 } );
//             } );
//             const detA = A.x.mul(A.y).sub( A.z.mul(A.z) );  
//             const invA = TSL.vec3( A.y, A.x, A.z.negate()).div( detA );
//             const flow = TSL.vec2(
//                 invA.x.mul(b.x).add( invA.z.mul(b.y) ),
//                 invA.z.mul(b.x).add( invA.y.mul(b.y) )
//             ).negate().div(videoResolution);
//             displacement.addAssign(flow.mul(.5));
//         } );
//         position.addAssign(displacement);
//         colorBuffer.element( TSL.instanceIndex ).assign(clr)
//     } )().compute(count);

//     DICInitialized = true;
// }

// const resetDIC = () => {
//     renderer.computeAsync( computeInit );
//     refTexture.copy(videoTexture);
// }




// ----------------------------------------------------------------------
// AUDIO
// ----------------------------------------------------------------------

PARAMS.strobe = {
    signalRepetitionFrequency: 100.0,
    lightPulseDriftFrequency: 0.75,
    lightPulseSyncPhaseWithFrames: false,
    lightPulseDuty: 0.05,
    lightPulsePhase: 0.0,
    lightPulseDCOffset: -1.0,
    frequencyChangeRate: 0.0,
}

// create an AudioContext
// const listener = new THREE.AudioListener();
// const audioContext = listener.context;
const audioContext = new AudioContext();
console.log(audioContext.sampleRate);

// Excitation signal
const signalOscillator = audioContext.createOscillator();
signalOscillator.type = 'sine';
function setSignalFrequency() {signalOscillator.frequency.setValueAtTime(PARAMS.strobe.signalRepetitionFrequency, audioContext.currentTime);}

// PWM PULSE USING PERIODIC WAVEFORM// Function to create a PWM waveform
function createPWMWave(audioContext,dutyCycle) {
    const nFreqs = Math.ceil(10/Math.max(dutyCycle,0.001));
    const alpha = 1.2;
    const real = new Float32Array(nFreqs);
    const imag = new Float32Array(nFreqs);
    real[0] = dutyCycle;
    for (let ff=1; ff<nFreqs; ff++) {
        real[ff] = Math.sin(2 * Math.PI * ff * dutyCycle) / (ff**alpha * Math.PI);
        imag[ff] = (1 - Math.cos(2 * Math.PI * ff * dutyCycle)) / (ff**alpha * Math.PI);
    }

    return audioContext.createPeriodicWave(real, imag);
}
const pwmOscillator = audioContext.createOscillator();
function setLightPulseFrequency() {pwmOscillator.frequency.setValueAtTime(PARAMS.strobe.signalRepetitionFrequency - PARAMS.strobe.lightPulseDriftFrequency*(1.0-PARAMS.strobe.lightPulseSyncPhaseWithFrames), audioContext.currentTime);}
function setLightPulseDuty() {pwmOscillator.setPeriodicWave(createPWMWave(audioContext, PARAMS.strobe.lightPulseDuty))};

// Delay node for static phase shift
const delayNode = audioContext.createDelay();
function setDelayTime() {delayNode.delayTime.setValueAtTime(PARAMS.strobe.lightPulsePhase/PARAMS.strobe.signalRepetitionFrequency, audioContext.currentTime);};

// Connections
// Create a ChannelMerger to handle left and right channels
const channelMerger = audioContext.createChannelMerger(2);
signalOscillator.connect(channelMerger, 0, 0); // Connect to left channel
pwmOscillator.connect(delayNode, 0, 0);
delayNode.connect(channelMerger, 0, 1); // Connect to right channel
channelMerger.connect(audioContext.destination); // Connect the merged channels to the destination

// Init and audio Nodes with default parameters
setSignalFrequency();
setLightPulseFrequency();
setLightPulseDuty();
setDelayTime();
signalOscillator.start(audioContext.currentTime);
pwmOscillator.start(audioContext.currentTime);


// ----------------------------------------------------------------------
// GUI
// ----------------------------------------------------------------------

async function initGUI() {

    const gui = renderer.inspector.createParameters( 'Parameters' );

    // Control camera settings
    const videoTrack = stream.getVideoTracks()[0];
    const videoSettings = videoTrack.getSettings();
    const videoCapabilities = videoTrack.getCapabilities();
    const videoFolder = gui.addFolder('Camera Controls')
    for (let setting in videoSettings) {
        const capability = videoCapabilities[setting]
        if (!Array.isArray(capability) && capability.constructor != Object) continue;
        
        let ui
        if (Array.isArray(capability)) {
            ui = videoFolder.add( videoSettings, setting, capability );
        }
        else {
            ui = videoFolder.add( videoSettings, setting, capability.min, capability.max, capability.step);
        }

        ui.onChange(()=>{
            videoTrack.applyConstraints({
                [setting]: videoSettings[setting]
            }).then(()=>{
                // console.log(setting,capability,videoTrack.getSettings()[setting]);
                // videoSettings[setting] = videoTrack.getSettings()[setting];
            });
        })
    }
    videoFolder.close()
    
    // DIC Settings
    const DICFolder = gui.addFolder('DIC')
        DICFolder.add(PARAMS,'autoUpdateReferenceImage').name('Update Reference')
        DICFolder.add( { setReferenceImage }, 'setReferenceImage' ).name('Set Reference');

    // VIZUALIZATION
    const vizFolder = gui.addFolder('Visualization')
        vizFolder.add(detHessBias,'value',-30,-1,1).name('Alpha')
        vizFolder.add(imagePlane.material,'colorNode',{
            video:TSL.texture(videoTexture),
            current:currentImage,
            reference:referenceImage,
            diff:diffImage,
            grad:clrGradImage,
            flow:clrFlowImage,
            blend_flow:blendFlowImage,
        }).name('Background Image').onChange(()=>{imagePlane.material.needsUpdate = true})
        vizFolder.add(vec2rgbY,'value',0.0,1.0).name('vec2rgbY')
        vizFolder.add(vec2rgbMul,'value',-2.0,2.0).name('vec2rgbMul')

    // STROBE
    const strobeFolder = gui.addFolder('Strobe')
        strobeFolder.add(PARAMS.strobe,'signalRepetitionFrequency',1,1000.0).name('Signal Frequency')
            .onChange(()=>{
                setSignalFrequency();
                setLightPulseFrequency();
                setDelayTime();
            })
        strobeFolder.add(PARAMS.strobe,'lightPulseDuty',0.0,1.0).name('Light Pulse Duty')
            .onChange(()=>{
                setLightPulseDuty();
            })
        strobeFolder.add(PARAMS.strobe,'lightPulsePhase',0.0,1.0).name('Light Pulse Phase')
            .onChange(()=>{
                setDelayTime();
            })
        strobeFolder.add(PARAMS.strobe,'lightPulseDriftFrequency',0.0,1.0).name('Light Drift Frequency')
            .onChange(()=>{
                setLightPulseFrequency();
            })
        strobeFolder.add(PARAMS.strobe,'lightPulseSyncPhaseWithFrames').name('Sync with Frames')
            .onChange(()=>{
                setLightPulseFrequency();
            })
        strobeFolder.add(PARAMS.strobe,'frequencyChangeRate',-0.05,0.05,0.00000001).name('Frequency Change Rate')

        
        
}

await initGUI();


// ----------------------------------------------------------------------
// ANIMATION LOOP
// ----------------------------------------------------------------------

// 5. Animation Loop
var lastTime = -1;
async function animate() {
    // requestAnimationFrame(animate);

    let time = videoObject.currentTime;
    if (time!=lastTime){
        const vfps = 1.0/(time-lastTime);
        // console.log("VFPS:", vfps);
        lastTime = time;

        setCurrentImage()

        renderer.render(scene, camera);

        if (PARAMS.autoUpdateReferenceImage) setReferenceImage() ;

        PARAMS.strobe.signalRepetitionFrequency = PARAMS.strobe.signalRepetitionFrequency*(1.0+PARAMS.strobe.frequencyChangeRate/vfps);
        PARAMS.strobe.lightPulsePhase += PARAMS.strobe.lightPulseDriftFrequency/vfps*PARAMS.strobe.lightPulseSyncPhaseWithFrames
        setSignalFrequency();
        setLightPulseFrequency();
        setDelayTime();
        // console.log(PARAMS.strobe.signalRepetitionFrequency)
    }

}


// Start everything
// await initVideo();
// await initRenderer();
// await initImageViewer();
// await initGUI();
// await animate();
await renderer.setAnimationLoop(animate)



