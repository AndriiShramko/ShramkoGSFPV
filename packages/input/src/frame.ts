// The button bits a raw frame (calib.ts RawFrame) carries: 24, the EdgeTX USB joystick's 3 button
// bytes. The HID reader, the gamepad source, the wizard, the mode switch and the channel functions
// all use this one number (a leaf module, so every one of them can import it without a cycle).
export const FRAME_BUTTONS = 24;
