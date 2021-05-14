import React, { useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { VRM, VRMSchema } from "@pixiv/three-vrm";
import { Canvas, extend, useFrame, useThree } from "react-three-fiber";

class ControlObject {
  constructor() {
    this.T = 0.1; // time interval (second)
    this.ALPHA = 0.7; // incomplete derivative coefficient [ tunable param ]
    this.KP = 0.04; // [ tunable param ]
    this.KD = 1; // [ tunable param ]
    this.KP = 0.04;
    this.KD = 1;
    this.M = 1; // mass
    this.a = 0; // acceleration
    this.v = 0; // velocity
    this.x = 0; // position
    this.x_d = 0; // desired position
    this.e = 0; // error
    this.e_1 = 0; // last error
    this.de = 0; // derivative of error
    this.p_out = 0; // propotional term
    this.d_out = 0; // derivative term
    this.d_out_1 = 0; // last derivative term
    this.F = 0; // control force

    this.THRESH = 0.05; // control law changing threshold
  }
  control(X, X_D) {
    this.x = X;
    this.x_d = X_D;

    this.e = this.x_d - this.x; // update error
    this.de = (this.e - this.e_1) / this.T; // compute derivative of error
    this.p_out = this.KP * this.e;
    this.d_out =
      (1 - this.ALPHA) * this.KD * this.de + this.ALPHA * this.d_out_1;

    this.F = this.p_out + this.d_out; // update control force

    this.e_1 = this.e; // update last error
    this.d_out_1 = this.d_out; // update last derivative term

    this.a = this.F / this.M; // update acceleration
    this.v = this.v + this.a * this.T; // update velocity
    this.x = this.x + this.v * this.T; // update position
    if (this.x < 0) {
      this.x = 0;
    }
    return this.x;
  }
}

class KalmanObject {
  constructor() {
    this.K = 0;
    this.X = 0;
    this.P = 0.1;
  }
  kalman_filter(input, Q, R) {
    this.K = this.P / (this.P + R);
    this.X = this.X + this.K * (input - this.X);
    this.P = this.P - this.K * this.P + Q;
    return this.X;
  }
}

/*================================
  state variable (below)
  ================================*/
var toggle = false;
var defaultCamera = false;
/*================================
  state variable (above)
  ================================*/

/*================================
  VRM variable (below)
  ================================*/
const leftEyeControl = new ControlObject();
const rightEyeControl = new ControlObject();
const mouthWidControl = new ControlObject();
const mouthLenControl = new ControlObject();
leftEyeControl.M = 2;
leftEyeControl.ALPHA = 0.8;
leftEyeControl.KP = 0.04;
leftEyeControl.KD = 1;

rightEyeControl.M = 2;
rightEyeControl.ALPHA = 0.8;
rightEyeControl.KP = 0.04;
rightEyeControl.KD = 1;

const kalman = new KalmanObject();

const gridHelper = new THREE.GridHelper(10, 10);
const axesHelper = new THREE.AxesHelper(5);
/*================================
  VRM variable (above)
  ================================*/

/*================================ 
  vrm functions (below)
  ================================*/
const useVrm = () => {
  const { current: loader } = useRef(new GLTFLoader());
  const [vrm, setVrm] = useState(null);
  const [data, setData] = useState({ stop: true, w: null });

  const loadVrm = (url) => {
    loader.load(url, async (gltf) => {
      const vrm = await VRM.from(gltf);
      vrm.humanoid.getBoneNode(VRMSchema.HumanoidBoneName.Hips).rotation.y =
        Math.PI;
      vrm.humanoid.getBoneNode(
        VRMSchema.HumanoidBoneName.LeftUpperArm
      ).rotation.z = 1.25;
      vrm.humanoid.getBoneNode(
        VRMSchema.HumanoidBoneName.RightUpperArm
      ).rotation.z = -1.25;
      setVrm(vrm);
    });
  };

  const changeExpression = () => {
    if (vrm) {
      if (!toggle) {
        vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.Joy, 1);
        vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.BlinkL, 0);
        vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.BlinkR, 0);
        vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.A, 0);
        vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.I, 0);
        toggle = true;
      } else {
        vrm.blendShapeProxy.setValue(VRMSchema.BlendShapePresetName.Joy, 0);
        toggle = false;
      }
      vrm.blendShapeProxy.update();
      console.log(vrm);
    }
  };

  const startCamera = () => {
    if (vrm) {
      fetch("/start").then((response) => response.json());
    }
  };

  const stopCamera = () => {
    fetch("/stop").then((response) => response.json());
  };

  const [rightEyeWeight, setRightEyeWeight] = useState(0);
  const [leftEyeWeight, setLeftEyeWeight] = useState(0);
  const [mouthWidWeight, setMouthWidWeight] = useState(0);
  const [mouthLenWeight, setMouthLenWeight] = useState(0);

  const [rightEyeShape, setRightEyeShape] = useState(0);
  const [leftEyeShape, setLeftEyeShape] = useState(0);
  const [mouthWidShape, setMouthWidShape] = useState(0);
  const [mouthLenShape, setMouthLenShape] = useState(0);

  const [w, setW] = useState(0);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [z, setZ] = useState(0);

  const getRightEyeWeight = async (getRightEyeShape) => {
    var finalShape = 0;
    if (getRightEyeShape < 0.05) {
      finalShape = 0.01;
    } else {
      finalShape = rightEyeControl.control(rightEyeShape, getRightEyeShape);
    }
    if (finalShape < 0.05) {
      setRightEyeWeight(1);
    } else if (finalShape < 0.1) {
      setRightEyeWeight(5 / finalShape / 100);
    } else if (finalShape < 0.12) {
      setRightEyeWeight((100 - 500 * finalShape) / 100);
    } else {
      setRightEyeWeight(0);
    }
  };

  const getLeftEyeWeight = async (getLeftEyeShape) => {
    var finalShape = 0;
    if (getLeftEyeShape < 0.05) {
      finalShape = 0.01;
    } else {
      finalShape = leftEyeControl.control(leftEyeShape, getLeftEyeShape);
    }
    if (finalShape < 0.05) {
      setLeftEyeWeight(1);
    } else if (finalShape < 0.1) {
      setLeftEyeWeight(5 / finalShape / 100);
    } else if (finalShape < 0.12) {
      setLeftEyeWeight((100 - 500 * finalShape) / 100);
    } else {
      setLeftEyeWeight(0);
    }
  };
  const getMouthWidWeight = async (getMouthWidShape) => {
    var finalShape = 0;
    finalShape = mouthWidControl.control(mouthWidShape, getMouthWidShape);
    if (5 * finalShape < 1) {
      setMouthWidWeight(5 * finalShape);
    } else {
      setMouthWidWeight(1);
    }
  };

  const getMouthLenWeight = async (getMouthLenShape) => {
    var finalShape = 0;
    finalShape = mouthLenControl.control(mouthLenShape, getMouthLenShape);
    if (finalShape < 0.1) {
      setMouthLenWeight(0.5);
    } else if (finalShape < 0.4) {
      setMouthLenWeight((120 - 400 * finalShape) / 100);
    } else {
      setMouthLenWeight(0);
    }
  };

  const getRotation = async (w, x, y, z) => {
    const kw = kalman.kalman_filter(w, 8e-3, 5e-4);
    const kx = kalman.kalman_filter(x, 8e-3, 5e-4);
    const ky = kalman.kalman_filter(y, 8e-3, 5e-4);
    const kz = kalman.kalman_filter(z, 8e-3, 5e-4);

    // setW(kalman.kalman_filter(w,8e-3,5e-4))
    // setX(kalman.kalman_filter(x,8e-3,5e-4))
    // setY(kalman.kalman_filter(y,8e-3,5e-4))
    // setZ(kalman.kalman_filter(z,8e-3,5e-4))

    setW(Math.cos(1.6) * kw - Math.sin(1.6) * kx);
    setX(Math.cos(1.6) * kx + Math.sin(1.6) * kw);
    setY(Math.cos(1.6) * ky - Math.sin(1.6) * kz);
    setZ(Math.cos(1.6) * kz + Math.sin(1.6) * ky);
  };

  // use for animation
  useEffect(() => {
    const interval = setInterval(() => {
      if (vrm) {
        fetch("/getPrediction")
          .then((response) => response.json())
          .then((data) => setData(data));
      }
      if (vrm && data.stop === false && data.w) {
        // get data
        // const start = performance.now()

        // Control noise & get blendshape weight
        // 1.right eye
        getRightEyeWeight(data.rightEyeWid);
        // 2.left eye
        getLeftEyeWeight(data.leftEyeWid);
        // 3.mouth length
        getMouthLenWeight(data.mouthLen);
        // 4.mouth width
        getMouthWidWeight(data.mouthWid);

        // // apply kalman filter to quaternion
        getRotation(data.w, data.x, data.y, data.z);

        // update global parameter
        setRightEyeShape(data.rightEyeWid);
        setLeftEyeShape(data.leftEyeWid);
        setMouthLenShape(data.mouthLen);
        setMouthWidShape(data.mouthWid);

        // apply weights and update model
        // console.log(data)
        // console.log(w)
        if (!toggle) {
          vrm.blendShapeProxy.setValue(
            VRMSchema.BlendShapePresetName.BlinkL,
            leftEyeWeight
          );
          vrm.blendShapeProxy.setValue(
            VRMSchema.BlendShapePresetName.BlinkR,
            rightEyeWeight
          );
          vrm.blendShapeProxy.setValue(
            VRMSchema.BlendShapePresetName.A,
            mouthWidWeight
          );
          vrm.blendShapeProxy.setValue(
            VRMSchema.BlendShapePresetName.I,
            mouthLenWeight
          );
        }
        vrm.humanoid.getBoneNode(
          VRMSchema.HumanoidBoneName.Head
        ).rotation.w = w;
        vrm.humanoid.getBoneNode(
          VRMSchema.HumanoidBoneName.Head
        ).rotation.x = x;
        vrm.humanoid.getBoneNode(
          VRMSchema.HumanoidBoneName.Head
        ).rotation.y = y;
        vrm.humanoid.getBoneNode(
          VRMSchema.HumanoidBoneName.Head
        ).rotation.z = z;

        vrm.blendShapeProxy.update();
        // var end = performance.now()
        // console.log("time spent "+ (end-start) + 'ms.')
      }
    }, 10);
    return () => {
      clearInterval(interval);
    };
  });

  return { vrm, loadVrm, changeExpression, startCamera, stopCamera };
};
/*================================ 
  vrm functions (above)
  ================================*/

/*================================ 
  camera control (below)
  ================================*/
// Extend will make OrbitControls available as a JSX element called orbitControls for us to use.
extend({ OrbitControls });
const CameraControls = () => {
  const {
    camera,
    gl: { domElement },
  } = useThree();
  if (!defaultCamera) {
    camera.position.set(0, 1.5, 0.75);
    defaultCamera = true;
  }
  // Ref to the controls, so that we can update them on every frame using useFrame
  const controls = useRef();
  useFrame(() => {
    controls.current.target = new THREE.Vector3(0, 1.5, 0);
    controls.current.update();
  });
  return <orbitControls ref={controls} args={[camera, domElement]} />;
};
/*================================ 
  camera control (above)
  ================================*/

/*================================ 
  main (below)
  ================================*/
const App = () => {
  const { vrm, loadVrm, changeExpression, startCamera, stopCamera } = useVrm();
  const handleFileChange = (event) => {
    const url = URL.createObjectURL(event.target.files[0]);
    defaultCamera = false;
    loadVrm(url);
  };

  return (
    <>
      {/* <input type="file" accept=".vrm" onChange={handleFileChange} /> */}
      <input
        type="file"
        accept=".vrm"
        onChange={handleFileChange}
        name="add_model"
        id="add_model"
        style={{ visibility: "hidden" }}
      />
      <label
        class="btn btn-primary"
        for="add_model"
        style={{
          zIndex: 10,
          position: "absolute",
          marginTop: "45.2rem",
          marginLeft: "55rem",
          color: "#704ef4",
          backgroundColor: "transparent",
          border: "none",
        }}>
        <img
          src="../src/image/modelling.png"
          class="icon"
          alt="Responsive image"
          style={{ marginLeft: "1rem", marginBottom: "-1rem" }}
        />
        <br />
        <br />
        Add model
      </label>
      <div
        style={{
          position: "absolute",
          marginLeft: "95rem",
          marginTop: "30rem",
          zIndex: "1",
          textAlign: "right",
        }}>
        <button
          onClick={changeExpression}
          style={{ backgroundColor: "#704ef4", borderRadius: "5px" }}>
          {" "}
          Smile{" "}
        </button>
        <br />
        <button onClick={startCamera} style={{ borderRadius: "5px" }}>
          {" "}
          Open camera{" "}
        </button>
        <br />
        <button onClick={stopCamera} style={{ borderRadius: "5px" }}>
          {" "}
          Close camera{" "}
        </button>
      </div>
      <Canvas
        id="canvas-model"
        style={{
          height: 800,
          width: 600,
          marginLeft: "60rem",
          position: "relative",
          overflow: "visible",
          marginTop: "-10rem",
        }}>
        <CameraControls />
        <spotLight position={[0, 0, 10]} />
        {vrm && <primitive object={vrm.scene} />}
        {/* <gridHelper /> */}
        {/* <axesHelper /> */}
      </Canvas>
    </>
  );
};
/*================================ 
  main (above)
  ================================*/

export default App;
