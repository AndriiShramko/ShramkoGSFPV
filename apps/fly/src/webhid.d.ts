// Minimal WebHID typings (the subset the simulator uses). Spec: https://wicg.github.io/webhid/
export {};

declare global {
    interface HIDDeviceFilter {
        vendorId?: number;
        productId?: number;
        usagePage?: number;
        usage?: number;
    }

    interface HIDInputReportEvent extends Event {
        readonly device: HIDDevice;
        readonly reportId: number;
        readonly data: DataView;
    }

    interface HIDDevice extends EventTarget {
        readonly opened: boolean;
        readonly vendorId: number;
        readonly productId: number;
        readonly productName: string;
        open(): Promise<void>;
        close(): Promise<void>;
        addEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void;
        removeEventListener(type: 'inputreport', listener: (e: HIDInputReportEvent) => void): void;
    }

    interface HID extends EventTarget {
        getDevices(): Promise<HIDDevice[]>;
        requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
    }
}
