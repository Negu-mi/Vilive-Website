import cv2
import numpy as np
import dlib
import time
import math
import sys
import threading
from pathlib import Path
from flask import Flask, jsonify, send_from_directory

################################################
#       Face detection part  ( below )
################################################

path = Path().absolute()
detector = dlib.get_frontal_face_detector()
predictor = dlib.shape_predictor(str(path) + '/' + 'data/' + 'shape_predictor_68_face_landmarks.dat')
POINTS_NUM_LANDMARK = 68

clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8,8)) # CLAHE Object (for Adaptive histogram equalization)
boxPoints3D = np.array(([500., 500., 500.],
                         [-500., 500., 500.],
                         [-500., -500., 500.],
                         [500., -500., 500.],
                         [500., 500., -500.],
                         [-500., 500., -500.],
                         [-500., -500., -500.],
                         [500., -500., -500.]))
boxPoints2D = np.zeros((1,1,8,2))
# parameters for mean filter
windowlen_1 = 5
queue3D_points = np.zeros((windowlen_1,POINTS_NUM_LANDMARK,2))

windowlen_2 =5
queue1D = np.zeros(windowlen_2)

# pamameters for kalman filter
XX = 0
PP = 0.01

# Smooth filter
def mean_filter_for_landmarks(landmarks_orig):
    for i in range(windowlen_1-1):
        queue3D_points[i,:,:] = queue3D_points[i+1,:,:]
    queue3D_points[windowlen_1-1,:,:] = landmarks_orig
    landmarks = queue3D_points.mean(axis = 0)
    return landmarks

def mean_filter_simple(input):
    for i in range(windowlen_2-1):
        queue1D[i] = queue1D[i+1]
    queue1D[windowlen_2-1] = input
    output = queue1D.mean()
    return output

def kalman_filter_simple(input, Q, R):
    global XX
    global PP
    K = PP / (PP + R)
    XX = XX + K * (input - XX)
    PP = PP - K * PP + Q
    return XX

class KalmanObject:
    def __init__(self, m, Qval, Rval):
        self.K = np.zeros((m,m))
        self.xx = np.zeros(m)
        self.P = np.eye(m)
        self.F = np.eye(m)
        self.B = np.eye(m)
        self.H = np.eye(m)
        self.Q = Qval * np.eye(m)
        self.R = Rval * np.eye(m)

    def kalman_update(self, uu, zz):
        self.xx = self.F.dot(self.xx) + self.B.dot(uu)
        self.P = self.F.dot(self.P).dot(self.F.T) + self.Q
        self.K = self.P.dot(self.H.T).dot( np.linalg.inv(self.H.dot(self.P).dot(self.H.T) + self.R) )
        self.xx = self.xx + self.K.dot(zz - self.H.dot(self.xx))
        self.P = self.P - self.K.dot(self.H).dot(self.P)

# Format convert      
def landmarks_to_np(landmarks, dtype="int"):
    # get number of landmarks
    num = landmarks.num_parts
    
    # initialize the list of (x, y)-coordinates
    coords = np.zeros((num, 2), dtype=dtype)
    
    # loop over the 68 facial landmarks and convert them
    # to a 2-tuple of (x, y)-coordinates
    for i in range(0, num):
        coords[i] = (landmarks.part(i).x, landmarks.part(i).y)
    # return the list of (x, y)-coordinates
    return coords

# Get feature_parameters of facial expressions
def get_feature_parameters(landmarks):
    d00 =np.linalg.norm(landmarks[27]-landmarks[8]) # Length of face (eyebrow to chin)
    d11 =np.linalg.norm(landmarks[0]-landmarks[16]) # width of face
    d_reference = (d00+d11)/2
    # Left eye
    d1 =  np.linalg.norm(landmarks[37]-landmarks[41])
    d2 =  np.linalg.norm(landmarks[38]-landmarks[40])
    # Right eye
    d3 =  np.linalg.norm(landmarks[43]-landmarks[47])
    d4 =  np.linalg.norm(landmarks[44]-landmarks[46])
    # Mouth width
    d5 = np.linalg.norm(landmarks[51]-landmarks[57])
    # Mouth length
    d6 = np.linalg.norm(landmarks[60]-landmarks[64])
    
    leftEyeWid = ((d1+d2)/(2*d_reference) - 0.02)*6
    rightEyewid = ((d3+d4)/(2*d_reference) -0.02)*6
    mouthWid = (d5/d_reference - 0.13)*1.27+0.02
    mouthLen = d6/d_reference

    return leftEyeWid, rightEyewid, mouthWid,mouthLen


# Get largest face
def get_largest_face(dets):
    if len(dets) == 1:
        return 0

    face_areas = [ (det.right()-det.left())*(det.bottom()-det.top()) for det in dets]

    largest_area = face_areas[0]
    largest_index = 0
    for index in range(1, len(dets)):
        if face_areas[index] > largest_area :
            largest_index = index
            largest_area = face_areas[index]

    # print("largest_face index is {} in {} faces".format(largest_index, len(dets)))

    return largest_index
    
# Feature points extraction using dlib
def get_image_points(img):                        
    gray = cv2.cvtColor( img, cv2.COLOR_BGR2GRAY )
    gray_eq = clahe.apply(gray) # Adaptive histogram equalization  
    #cv2.imshow("gray",gray)
    #cv2.imshow("gray_eq",gray_eq)
    dets = detector( gray_eq, 0 )

    if 0 == len( dets ):
        # print( "ERROR: found no face" )
        return -1, None
    largest_index = get_largest_face(dets)
    face_rectangle = dets[largest_index]

    landmark_shape = predictor(img, face_rectangle)

    return 0, landmark_shape


# Pose estimation: get rotation vector and translation vector           
def get_pose_estimation(img_size, image_points ):
    # 3D model points
    model_points = np.array([
                                (0.0, 0.0, 0.0),             # Nose tip
                                (0.0, -330.0, -65.0),        # Chin
                                (-225.0, 170.0, -135.0),     # Left eye left corner
                                (225.0, 170.0, -135.0),      # Right eye right corner
                                (-349.0, 85.0, -300.0),      # Left head corner
                                (349.0, 85.0, -300.0)        # Right head corner
                             
                            ])
    # Camera internals     
    focal_length = img_size[1]
    center = (img_size[1]/2, img_size[0]/2)
    camera_matrix = np.array(
                             [[focal_length, 0, center[0]],
                             [0, focal_length, center[1]],
                             [0, 0, 1]], dtype = "double"
                             )     
    # print("Camera Matrix:\n {}".format(camera_matrix))
     
    dist_coeffs = np.zeros((4,1)) # Assuming no lens distortion
    imagePoints = np.ascontiguousarray(image_points[:,:2]).reshape((6,1,2))
    (success, rotation_vector, translation_vector) = cv2.solvePnP(model_points, imagePoints, camera_matrix, dist_coeffs, flags=cv2.SOLVEPNP_DLS)
    
    ############################

    # print("Rotation Vector:\n {}".format(rotation_vector))
    # print("Translation Vector:\n {}".format(translation_vector))
    return success, rotation_vector, translation_vector, camera_matrix, dist_coeffs

# Convert rotation_vector to quaternion
def get_quaternion(rotation_vector):
    # calculate rotation angles
    theta = cv2.norm(rotation_vector, cv2.NORM_L2)
    
    # transformed to quaterniond
    w = math.cos(theta / 2)
    x = math.sin(theta / 2)*rotation_vector[0][0] / theta
    y = math.sin(theta / 2)*rotation_vector[1][0] / theta
    z = math.sin(theta / 2)*rotation_vector[2][0] / theta
    return round(w,4), round(x,4), round(y,4), round(z,4)

data_dict = None
stop = bool
def run():
    # initialize kalman object
    global data_dict
    KalmanX = KalmanObject(POINTS_NUM_LANDMARK, 1,10) # Tune Q, R to change landmarks_x sensitivity
    KalmanY = KalmanObject(POINTS_NUM_LANDMARK, 1,10) # Tune Q, R to change landmarks_y sensitivity
    uu_ = np.zeros((POINTS_NUM_LANDMARK))
    # initialize PARAMETERS
    landmarks = np.zeros((POINTS_NUM_LANDMARK,2))

    open_time = time.time()
    cap = cv2.VideoCapture(0)
    while (cap.isOpened()):
        start_time = time.time()
        
        # Read Image
        ret, img = cap.read()
        img = cv2.flip(img,1)
        if ret != True:
            # print('read frame failed')
            #continue
            break
        size = img.shape
        
        if size[0] > 700:
            h = size[0] / 3
            w = size[1] / 3
            img = cv2.resize( img, (int( w ), int( h )), interpolation=cv2.INTER_CUBIC )
            size = img.shape
        
        ret, landmark_shape = get_image_points(img)
        if ret != 0:
            # print('ERROR: get_image_points failed')
            continue
        
        # Compute feature parameters of facial expressions (eyes, mouth)
        landmarks_orig = landmarks_to_np(landmark_shape) # convert format
        
        # Apply kalman filter to landmarks FOR POSE ESTIMATION
        KalmanX.kalman_update(uu_, landmarks_orig[:,0])
        KalmanY.kalman_update(uu_, landmarks_orig[:,1])
        landmarks[:,0] = KalmanX.xx.astype(np.int32)
        landmarks[:,1] = KalmanY.xx.astype(np.int32)

        landmarks = mean_filter_for_landmarks(landmarks) # Apply smooth filter to landmarks FOR POSE ESTIMATION
        leftEyeWid, rightEyewid, mouthWid,mouthLen = get_feature_parameters(landmarks_orig)
        parameters_str = 'leftEyeWid:{}, rightEyewid:{}, mouthWid:{}, mouthLen:{}'.format(leftEyeWid, rightEyewid, mouthWid, mouthLen)
        # print(parameters_str)

        # Five feature points for pose estimation
        image_points = np.vstack((landmarks[30],landmarks[8],landmarks[36],landmarks[45],landmarks[1],landmarks[15]))
        
        ret, rotation_vector, translation_vector, camera_matrix, dist_coeffs = get_pose_estimation(size, image_points)
        if ret != True:
            # print('ERROR: get_pose_estimation failed')
            continue
        used_time = time.time() - start_time
        # print("used_time:{} sec".format(round(used_time, 3)))
        
        # Convert rotation_vector to quaternion
        w,x,y,z = get_quaternion(rotation_vector)
        quaternion_str = 'w:{}, x:{}, y:{}, z:{}'.format(w, x, y, z)
        # print(quaternion_str)
        data_dict = {
            'w': w,
            'x': x,
            'y': y,
            'z': z,
            'leftEyeWid': leftEyeWid,
            'rightEyeWid': rightEyewid,
            'mouthWid': mouthWid,
            'mouthLen': mouthLen,
            'stop': stop
        }
        if stop == True:
            break
    
    cap.release()

################################################
#       Face detection part  ( above )
################################################


################################################
#       API part  ( below )
################################################

app = Flask(__name__)

@app.before_first_request
def set_stop():
    global stop
    stop = True

@app.route('/getPrediction', methods=['GET'])
def getPrediction():
    if data_dict is None:
        return {'stop': stop}
    else:
        return data_dict

@app.route('/start', methods=['GET'])
def startCamera():
    global stop
    if stop == True:
        stop = False
        thread = threading.Thread(target=run)
        thread.run()
        return {'stop': stop}
    else:
        return {'stop': stop}

@app.route('/stop', methods=['GET'])
def stopCamera():
    global stop
    stop = True
    return {'stop': stop}

app.config['frontend'] = '../frontend'
@app.route('/<path:filename>')
def getFile(filename):
    return send_from_directory(app.config['frontend'],filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0',port=3000, threaded=True)

################################################
#       API part  ( above )
################################################
