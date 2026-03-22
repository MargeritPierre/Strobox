import * as THREE from 'three/webgpu';
import * as OLDTHREE from 'three';
import * as TSL from 'three/tsl';
import {Inspector} from 'three/addons/inspector/Inspector.js';
import WebGPU from 'three/addons/capabilities/WebGPU.js';

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
        // width: { ideal: 4096 },
        // height: { ideal: 2160 } 
        // width: 1024//,height: 512,
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
// videoTexture.generateMipmaps = false;




// ----------------------------------------------------------------------
// SETUP THREEJS RENDERER
// ----------------------------------------------------------------------

// let useWebGPU = false && WebGPU.isAvailable()

// Scene & Camera (Orthographic for 2D feel)
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 0.1, 10); // Left, Right, Top, Bottom, Near, Far
camera.position.z = 1; // Position camera slightly away from origin

// WebGPU Renderer Setup
const renderer = new THREE.WebGPURenderer({ 
    antialias: false,
    // forceWebGL: !useWebGPU, //////////////////////////////////////////////////////////////////////////////////
    forceWebGL: true, //////////////////////////////////////////////////////////////////////////////////
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

// let videorenderer;
// if (useWebGPU) {
//     videorenderer = renderer;
// } else {
//     console.warn("WebGPU not available, falling back to WebGL. Performance may be degraded.");
//     videorenderer = new OLDTHREE.WebGLRenderer()
//     videorenderer.setPixelRatio(1.0);
//     videorenderer.setSize(videoObject.videoWidth, videoObject.videoHeight);
// }


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


function videoFrame() {
    // const tex = new THREE.Texture()
    // tex.copy(videoTexture) 
    // // console.log(videoObject.videoWidth, videoObject.videoHeight)
    // console.log(tex)
    // tex.generateMipmaps = false;
    // // tex.image = { 
    // //     width: videoObject.videoWidth, 
    // //     height: videoObject.videoHeight 
    // // };   
    // renderer.initTexture(tex);
    let tex = new THREE.VideoFrameTexture();
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.setFrame(new VideoFrame(videoObject));
    return tex;
}


function copyTexture(src,dst) {
    // console.log('Copying texture:', src, 'to', dst);
    // renderer.copyTextureToTexture(src,dst);
    const frame = new VideoFrame(videoObject);
    dst.source.data.close();
    dst.setFrame(frame);
    // frame.close();
    // dst.needsUpdate = true;
}

// ----------------------------------------------------------------------
// DIC SETUP
// ----------------------------------------------------------------------

// Current Image
const currentTexture = await videoFrame()
// currentTexture.setFrame(new VideoFrame(videoObject));
// const currentTexture = await videoFrame()
function setCurrentImage() { copyTexture(videoTexture,currentTexture) }
// setCurrentImage();
// await setImageViewerTexture(currentTexture);
console.log("Current texture initialized:", currentTexture);

// Reference Image
const referenceTexture = videoFrame()
function setReferenceImage() {
    // copyTexture(currentTexture,referenceTexture)
    renderer.copyTextureToTexture(currentTexture,referenceTexture);
}
setReferenceImage();
// await setImageViewerTexture(referenceImage);

// Difference Image
const diffImage = TSL.texture(currentTexture).sub(TSL.texture(referenceTexture).sample(TSL.uv()))
await setImageViewerTexture(diffImage);



async function animate() {
    renderer.render(scene, camera);
    setCurrentImage();
    // renderer.copyTextureToTexture(videoTexture,referenceTexture);
}
await renderer.setAnimationLoop(animate)