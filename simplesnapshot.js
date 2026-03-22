import * as THREE from 'three/webgpu';

// Initialisation de la scène, caméra, rendu
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGPURenderer({
    forcewebgl: true, // Forcer l'utilisation de WebGL pour la compatibilité
});
await renderer.init();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Demander l'accès à la webcam
navigator.mediaDevices.getUserMedia({ video: true })
  .then((stream) => {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();

    // Créer une texture à partir du flux vidéo
    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    // Créer un plan avec cette texture
    const geometry = new THREE.PlaneGeometry(10, 10);
    const material = new THREE.MeshBasicMaterial({ map: videoTexture });
    const plane = new THREE.Mesh(geometry, material);
    scene.add(plane);
    camera.position.z = 15;

    // Fonction pour capturer une image
    function captureFrame() {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const newTexture = new THREE.CanvasTexture(canvas);
      // Ici, tu peux utiliser newTexture comme tu veux (par exemple, l'appliquer à un autre objet)
      console.log("Image capturée !");
      return newTexture;
    }

    // Écouter les clics pour capturer une image
    window.addEventListener('click', captureFrame);

    // Animation loop
    function animate() {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    }
    animate();
  })
  .catch((err) => {
    console.error("Erreur d'accès à la webcam :", err);
  });
