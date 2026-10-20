// The drawing policy without the engine: how a scan is drawn (drawing.ts), which class of device this is
// (device-class.ts) and what each class starts with (presets.ts). Pure data and rules, so the owner's admin page
// (which must not pull PlayCanvas into its bundle) and the simulator read the very same table:
// import ... from '@gsfpv/render-pc/policy'.
export * from './drawing';
export * from './device-class';
export * from './presets';
