declare namespace BrowserPrint {
  interface DeviceJson {
    name: string;
    uid: string;
    connection: string;
    deviceType: string;
    provider: string;
    manufacturer: string;
    version?: number;
  }

  class Device {
    name: string;
    uid: string;
    connection: string;
    deviceType: string;
    provider: string;
    manufacturer: string;
    version: number;

    send(data: string, success?: () => void, error?: (err: unknown) => void): void;
    read(success: (data: string) => void, error?: (err: unknown) => void): void;
    sendThenRead(
      command: string,
      success: (data: string) => void,
      error?: (err: unknown) => void,
    ): void;
    readUntilStringReceived(
      str: string,
      success: (data: string) => void,
      error?: (err: unknown) => void,
    ): void;
  }

  type DeviceMap = { [key: string]: Device[] };

  function getLocalDevices(
    success: (devices: Device[]) => void,
    error?: (err: unknown) => void,
    type?: string,
  ): void;
  function getLocalDevices(
    success: (devices: DeviceMap) => void,
    error?: (err: unknown) => void,
  ): void;

  function getDefaultDevice(
    type: string | null,
    success: (device: Device | null) => void,
    error?: (err: unknown) => void,
  ): void;
}

declare namespace Zebra {
  namespace Printer {
    class Status {
      raw: string;
      offline: boolean;
      paperOut: boolean;
      paused: boolean;
      headOpen: boolean;
      ribbonOut: boolean;
      isPrinterReady(): boolean;
      getMessage(): string;
    }

    class Info {
      raw: string;
      model: string;
      firmware: string;
    }
  }

  class Printer extends BrowserPrint.Device {
    constructor(deviceJson: object);
    getStatus(
      success: (status: Printer.Status) => void,
      error?: (err: unknown) => void,
    ): Promise<Printer.Status>;
    getInfo(
      success: (info: Printer.Info) => void,
      error?: (err: unknown) => void,
    ): void;
  }
}
