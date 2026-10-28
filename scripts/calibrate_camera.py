"""Calibrate the SAME browser-delivered stream from opted-in PNG frames.
Requires: python -m pip install opencv-python numpy
Example: python scripts/calibrate_camera.py frames/*.png --columns 9 --rows 6 --square-mm 20 --provenance 'printed target measured with ruler, Safari 26, 640x480' --output camera-reference.json
"""
import argparse, glob, json
import cv2
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('images', nargs='+')
    parser.add_argument('--columns', type=int, required=True, help='Interior corners across')
    parser.add_argument('--rows', type=int, required=True, help='Interior corners down')
    parser.add_argument('--square-mm', type=float, required=True)
    parser.add_argument('--provenance', required=True)
    parser.add_argument('--output', default='camera-reference.json')
    args = parser.parse_args()
    if min(args.columns, args.rows) < 3 or args.square_mm <= 0:
        parser.error('Need at least 3x3 inner corners and positive physical square size')
    paths = sorted(set(p for pattern in args.images for p in glob.glob(pattern)))
    template = np.zeros((args.rows * args.columns, 3), np.float32)
    template[:, :2] = np.mgrid[0:args.columns, 0:args.rows].T.reshape(-1, 2) * args.square_mm
    objects, points, accepted, dimensions = [], [], [], None
    for path in paths:
        frame = cv2.imread(path)
        if frame is None:
            print('Skip unreadable', path)
            continue
        size = frame.shape[1], frame.shape[0]
        if dimensions is not None and size != dimensions:
            raise ValueError('Mixed image dimensions: calibrate each delivered configuration separately')
        dimensions = size
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        ok, corners = cv2.findChessboardCornersSB(gray, (args.columns, args.rows), flags=cv2.CALIB_CB_NORMALIZE_IMAGE)
        if ok:
            objects.append(template.copy())
            points.append(corners)
            accepted.append(path)
        else:
            print('No complete checkerboard:', path)
    if len(accepted) < 12:
        raise ValueError(f'Only {len(accepted)} useful images; capture at least 12 varied views')
    rms, matrix, distortion, rvecs, tvecs, std_intrinsics, _, per_view = cv2.calibrateCameraExtended(objects, points, dimensions, None, None)
    profile = dict(fx=float(matrix[0, 0]), fy=float(matrix[1, 1]), cx=float(matrix[0, 2]), cy=float(matrix[1, 2]),
                   width=dimensions[0], height=dimensions[1], distortion=distortion.ravel().tolist(),
                   orientation='landscape' if dimensions[0] > dimensions[1] else 'portrait', source='reference',
                   provenance=args.provenance, uncertainty=f'OpenCV fit RMS {rms:.4f} px; fit uncertainty is not independent accuracy',
                   referenceDetails=dict(rmsPx=rms, perViewRmsPx=per_view.ravel().tolist(), parameterStd=std_intrinsics.ravel().tolist(),
                                         acceptedImages=accepted, squareMm=args.square_mm, checkerboard=[args.columns,args.rows]))
    with open(args.output, 'w') as output:
        json.dump(profile, output, indent=2)
    print('Wrote', args.output, 'RMS pixels:', rms)
    print('Validate on withheld frames. Check crop, focus/stabilization and delivered dimensions before reuse.')


if __name__ == '__main__':
    main()
