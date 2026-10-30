// Bridge between GeoWebXR geoposes and the iTowns/three.js scene (EPSG:4978).
import * as THREE from 'three';
import { enuToEcefMatrix, geodeticToEcef, quatFromMat3 } from '../geowebxr/index.js';

/**
 * Place a three.js object (scene coordinates = ECEF) at a GeoWebXR geopose.
 * Used for the root of the XR scene graph (iTowns `vrControls.groupXR`), whose
 * local frame must be the WebXR reference space.
 * @param {THREE.Object3D} object3D - object to place
 * @param {object} geopose - `{ position: {lat, lon, h}, quaternion }`, quaternion mapping local → ENU
 */
export function applyGeoPose(object3D, geopose) {
    const { lat, lon, h } = geopose.position;
    const qEnuToEcef = quatFromMat3(enuToEcefMatrix(lat, lon));
    const q = geopose.quaternion;
    object3D.position.fromArray(geodeticToEcef(lat, lon, h));
    object3D.quaternion
        .set(qEnuToEcef.x, qEnuToEcef.y, qEnuToEcef.z, qEnuToEcef.w)
        .multiply(new THREE.Quaternion(q.x, q.y, q.z, q.w));
    object3D.updateMatrixWorld(true);
}
