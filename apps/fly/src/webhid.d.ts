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

    /** The part of the report descriptor the reader uses (HIDCollectionInfo / HIDReportInfo / HIDReportItem). */
    interface HIDReportItemInfo {
        readonly isConstant?: boolean;
        readonly isRange?: boolean;
        readonly usages?: readonly number[];
        readonly usageMinimum?: number;
        readonly usageMaximum?: number;
        readonly reportSize?: number;
        readonly reportCount?: number;
        readonly logicalMinimum?: number;
        readonly logicalMaximum?: number;
    }

    interface HIDCollectionInfoLike {
        readonly usagePage?: number;
        readonly usage?: number;
        readonly children?: readonly HIDCollectionInfoLike[];
        readonly inputReports?: readonly { readonly reportId: number; readonly items?: readonly HIDReportItemInfo[] }[];
    }

    interface HIDDevice extends EventTarget {
        readonly opened: boolean;
        readonly vendorId: number;
        readonly productId: number;
        readonly productName: string;
        readonly collections?: readonly HIDCollectionInfoLike[];
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
