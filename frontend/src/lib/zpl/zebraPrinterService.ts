import { RackLabelData, generateRackLabel, generateMultipleRackLabels } from './labelTemplates';

// Thin wrapper around the Zebra Browser Print global (loaded via the
// <script> tags in index.html — see BrowserPrint-*.min.js in /public).
// Mirrors the device discovery / send pattern used for roll labels in
// FabricRolls.tsx (BrowserPrint.getLocalDevices + Device.send).
export class ZebraPrinterService {
  /**
   * Check if Zebra Browser Print is available in this browser.
   */
  isAvailable(): boolean {
    return typeof BrowserPrint !== 'undefined';
  }

  /**
   * Get list of printers registered with Zebra Browser Print.
   */
  getAvailablePrinters(): Promise<BrowserPrint.Device[]> {
    return new Promise((resolve) => {
      if (!this.isAvailable()) {
        resolve([]);
        return;
      }
      BrowserPrint.getLocalDevices(
        (devices) => resolve(devices as BrowserPrint.Device[]),
        () => resolve([]),
        'printer',
      );
    });
  }

  /**
   * Send raw ZPL to a specific device.
   */
  private sendToDevice(device: BrowserPrint.Device, zpl: string): Promise<boolean> {
    return new Promise((resolve) => {
      device.send(
        zpl,
        () => resolve(true),
        (error) => {
          console.error('Print job failed:', error);
          resolve(false);
        },
      );
    });
  }

  /**
   * Print a single rack label to the given device.
   */
  async printRackLabel(labelData: RackLabelData, device: BrowserPrint.Device): Promise<boolean> {
    try {
      return await this.sendToDevice(device, generateRackLabel(labelData));
    } catch (error) {
      console.error('Error printing rack label:', error);
      return false;
    }
  }

  /**
   * Print multiple rack labels to the given device in a single print job.
   */
  async printMultipleRackLabels(racks: RackLabelData[], device: BrowserPrint.Device): Promise<boolean> {
    try {
      return await this.sendToDevice(device, generateMultipleRackLabels(racks));
    } catch (error) {
      console.error('Error printing multiple rack labels:', error);
      return false;
    }
  }
}

export const zebraPrinterService = new ZebraPrinterService();
