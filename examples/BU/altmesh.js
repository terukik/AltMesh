class AltMesh {
    constructor(name_prefix = 'MESH-100') {
        this.name_prefix = name_prefix;
        this.listeners = {};
    }

    addEventListener(type, listener) {
        if (typeof this.listeners[type] === 'undefined') {
            this.listeners[type] = [];
        }
        this.listeners[type].push(listener);
    }

    removeEventListener(type, listener) {
        if (typeof this.listeners[type] === 'undefined') {
            this.listeners[type] = [];
        }
        this.listeners[type] = this.listeners[type].filter((e) => e !== listener);
    }

    dispatchEvent(type, ...args) {
        if (typeof this.listeners[type] === 'undefined') {
            this.listeners[type] = [];
        }
        if (this.listeners[type].length === 0) {
            console.debug('no listener for', type, args);
        } else {
            try {
                this.listeners[type].forEach((e) => e(...args));
            } catch (error) {
                console.error(error);
            }
        }
    }

    async connect() {
        console.debug('>>>> connect');
        const SERVICE_UUID = '72c90001-57a9-4d40-b746-534e22ec9f9e';
        const CHARACTERISTIC_UUID_WRITE = '72c90004-57a9-4d40-b746-534e22ec9f9e';
        const CHARACTERISTIC_UUID_WRITE_WO_RESPONSE = '72c90002-57a9-4d40-b746-534e22ec9f9e';
        const CHARACTERISTIC_UUID_INDICATE = '72c90005-57a9-4d40-b746-534e22ec9f9e';
        const CHARACTERISTIC_UUID_NOTIFY = '72c90003-57a9-4d40-b746-534e22ec9f9e';
        const options = {
            filters: [
                { services: [SERVICE_UUID] },
                { namePrefix: this.name_prefix }
            ],
            optionalServices: [SERVICE_UUID],
        };
        try {
            this.device = await navigator.bluetooth.requestDevice(options);
            this.device.addEventListener('gattserverdisconnected', async () => {
                this.dispatchEvent('disconnect');
            });
            console.log('device name', this.device.name);
            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(SERVICE_UUID);
            this.characteristics = await this.service.getCharacteristics();
            this.characteristic_write = await this.service.getCharacteristic(CHARACTERISTIC_UUID_WRITE);
            this.characteristic_write_wo_response = await this.service.getCharacteristic(CHARACTERISTIC_UUID_WRITE_WO_RESPONSE);
            this.characteristic_indicate = await this.service.getCharacteristic(CHARACTERISTIC_UUID_INDICATE);
            this.characteristic_notify = await this.service.getCharacteristic(CHARACTERISTIC_UUID_NOTIFY);

            this.characteristic_indicate.addEventListener('characteristicvaluechanged', async (event) => {
                const buffer = Array(event.target.value.byteLength).fill();
                const command_frame = buffer.map((_, i) => event.target.value.getUint8(i));
                this.dispatchEvent('indicate', command_frame);
            });
            this.characteristic_notify.addEventListener('characteristicvaluechanged', async (event) => {
                const buffer = Array(event.target.value.byteLength).fill();
                const command_frame = buffer.map((_, i) => event.target.value.getUint8(i));
                this.dispatchEvent('notify', command_frame);
            });
            this.characteristic_indicate.startNotifications();
            this.characteristic_notify.startNotifications();
        } catch (error) {
            console.error(error);
        }
        console.debug('<<<< connect');
    }

    async write_with_response(data, append_checksum = true) {
        console.debug('>>>> write_with_response', data, append_checksum);
        let command_frame = data;
        if (append_checksum) {
            const sum = command_frame.reduce((a, c) => a + c, 0);
            command_frame = command_frame.concat([sum & 0xFF]);
        }
        try {
            console.log('writing:', command_frame);
            const value = new Uint8Array(command_frame);
            await this.characteristic_write.writeValue(value);
        } catch (error) {
            console.error(error);
        }
        console.debug('<<<< write_with_response');
    }

    async write(data, append_checksum = true) {
        console.debug('>>>> write', data, append_checksum);
        let command_frame = data;
        if (append_checksum) {
            const sum = command_frame.reduce((a, c) => a + c, 0);
            command_frame = command_frame.concat([sum & 0xFF]);
        }
        try {
            console.log('writing:', command_frame);
            const value = new Uint8Array(command_frame);
            await this.characteristic_write_wo_response.writeValue(value);
        } catch (error) {
            console.error(error);
        }
        console.debug('<<<< write');
    }
}

class AltMeshBase extends AltMesh {
    constructor(name_prefix = 'MESH-100') {
        super(name_prefix);
        this.block_type = null;

        const verify = (data) => {
            if (data.length < 3) {
                throw new Error('length error');
            }
            const sum = data.reduce((a, c) => a + c, 0);
            const last = data.slice(-1)[0];
            if ((sum - last) & 0xFF == last) {
                throw new Error('checksum error');
            }
            return true;
        }
        this.addEventListener('indicate', async (data) => {
            // console.debug('>>>> indicate', data);
            verify(data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x00, 0x02, 16].toString()) {
                const connected = (this.block_type === null);
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const toVersionString = (bs) => bs.map((e) => e.toString()).join('.');
                this.block_type = data[2];
                this.dispatchEvent('blocktype', {
                    event: 'blocktype',
                    block_type: data[2],
                });
                this.dispatchEvent('serialnumber', {
                    event: 'serialnumber',
                    serial_number: toUintLE(data.slice(3, 7)),
                });
                this.dispatchEvent('version', {
                    event: 'version',
                    version: toVersionString(data.slice(7, 10)),
                });
                this.dispatchEvent('batterylevel', {
                    event: 'batterylevel',
                    battery_level: data[14] * 10,
                });
                if (connected) {
                    this.dispatchEvent('blocktypedetected', data[2]);
                }
            }
            // console.debug('<<<< indicate');
        });
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            verify(data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x00, 0x00, 4].toString()) {
                this.dispatchEvent('batterylevel', {
                    event: 'batterylevel',
                    battery_level: data[2] * 10,
                });
            }
            if (id === [0x00, 0x01, 4].toString()) {
                this.dispatchEvent('statusbutton', {
                    event: 'statusbutton',
                    status: data[2],
                });
            }
            if (id === [0x00, 0x02, 16].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const toVersionString = (bs) => bs.map((e) => e.toString()).join('.');
                this.block_type = data[2];
                this.dispatchEvent('blocktype', {
                    event: 'blocktype',
                    block_type: data[2],
                });
                this.dispatchEvent('serialnumber', {
                    event: 'serialnumber',
                    serial_number: toUintLE(data.slice(3, 7)),
                });
                this.dispatchEvent('version', {
                    event: 'version',
                    version: toVersionString(data.slice(7, 10)),
                });
                this.dispatchEvent('batterylevel', {
                    event: 'batterylevel',
                    battery_level: data[14] * 10,
                });
            }
            // console.debug('<<<< notify');
        });
    }
    // Base write
    // - ステータスバーの点灯: 0x00, 0x00, redOnOff, greenOnOff, blueOnOff, statusbarOnOff
    // - ブロック機能の有効化: 0x00, 0x02, blockOnOff
    // - ブロックへの応答要求: 0x00, 0x03, 0x00
    // - ステータスバーの有効化 / 無効化: 0x00, 0x04, statusbarOnOff
    // - ブロックの電源オフ: 0x00, 0x05, 0x00
}

// 0x02: BU, #87c244
class AltMeshButton extends AltMeshBase {
    constructor(callback) {
        super('MESH-100BU');
        this.addEventListener('blocktypedetected', callback);
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x01, 0x00, 4].toString()) {
                this.dispatchEvent('button', {
                    event: 'button',
                    status: data[2],
                });
            }
            // console.debug('<<<< notify');
        });
    }
}

// 0x00: LE, #f0811e
class AltMeshLED extends AltMeshBase {
    constructor() {
        super('MESH-100LE');
    }
    // LED write
    // - LED点灯指示: 0x01, 0x00, red[2], green[2], blue[2], ontime[2], oncycle[2], offcycle[2], pattern
}

// 0x01: AC, #7bc9c2
class AltMeshMove extends AltMeshBase {
    constructor(callback) {
        super('MESH-100AC');
        this.addEventListener('blocktypedetected', callback);
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x01, 0x00, 17].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const acc = [2, 4, 6].map((e) => toUintLE(data.slice(e, e + 2))).map((e) => ((e <= 0x7FFF) ? e : e - 0x10000) / 1024.0);
                this.dispatchEvent('tap', {
                    event: 'tap',
                    x: acc[0],
                    y: acc[1],
                    z: acc[2],
                });
            }
            if (id === [0x01, 0x01, 17].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const acc = [2, 4, 6].map((e) => toUintLE(data.slice(e, e + 2))).map((e) => ((e <= 0x7FFF) ? e : e - 0x10000) / 1024.0);
                this.dispatchEvent('shake', {
                    event: 'shake',
                    x: acc[0],
                    y: acc[1],
                    z: acc[2],
                });
            }
            if (id === [0x01, 0x02, 17].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const acc = [2, 4, 6].map((e) => toUintLE(data.slice(e, e + 2))).map((e) => ((e <= 0x7FFF) ? e : e - 0x10000) / 1024.0);
                this.dispatchEvent('flip', {
                    event: 'flip',
                    x: acc[0],
                    y: acc[1],
                    z: acc[2],
                });
            }
            if (id === [0x01, 0x03, 17].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const acc = [2, 4, 6].map((e) => toUintLE(data.slice(e, e + 2))).map((e) => ((e <= 0x7FFF) ? e : e - 0x10000) / 1024.0);
                this.dispatchEvent('orientation', {
                    event: 'orientation',
                    orientation: data[2],
                    x: acc[0],
                    y: acc[1],
                    z: acc[2],
                });
            }
            // console.debug('<<<< notify');
        });
    }
}

// 0x10: MD, #23acd6
class AltMeshMotion extends AltMeshBase {
    constructor(callback) {
        super('MESH-100MD');
        this.addEventListener('blocktypedetected', callback);
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x01, 0x00, 6].toString()) {
                this.dispatchEvent('motion', data[2], data[3], data[4]);
            }
            // console.debug('<<<< notify');
        });
    }
    // Motion write
    // - モード設定: 0x01, 0x00, requestId, mode, keep[2], judge[2]
}

// 0x11: PA, #659ed1
class AltMeshBrightness extends AltMeshBase {
    constructor(callback) {
        super('MESH-100PA');
        this.addEventListener('blocktypedetected', callback);
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x01, 0x00, 13].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                this.dispatchEvent('brightness', {
                    event: 'brightness',
                    request_id: data[2],
                    mode: data[3],
                    brightness: toUintLE(data.slice(4, 6)),
                    proximity: toUintLE(data.slice(6, 8)) * 10,
                });
            }
            // console.debug('<<<< notify');
        });
    }
    // Brightness write
    // - モード設定: 0x01, 0x00, requestId, 0x00[10], 0x02[3], mode
}

// 0x12: TH, #6e72b4
class AltMeshTempHumid extends AltMeshBase {
    constructor(callback) {
        super('MESH-100TH');
        this.addEventListener('blocktypedetected', callback);
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x01, 0x00, 9].toString()) {
                const toUintLE = (bs) => bs.map((e, i) => (e << (8 * i))).reduce((a, c) => a + c, 0);
                const toIntLE = (bs) => { const u = toUintLE(bs); return (u <= 0x7FFF) ? u : (u - 0x10000); };
                const sensor = [4, 6].map((e) => toIntLE(data.slice(e, e + 2)));
                this.dispatchEvent('temphumid', {
                    event: 'temphumid',
                    request_id: data[2],
                    mode: data[3],
                    temperature: sensor[0] / 10.0,
                    humidity: sensor[1],
                });
            }
            // console.debug('<<<< notify');
        });
    }
    // TempHumid write
    // - モード設定: 0x01, 0x00, requestId, tempTop[2], tempBottom[2], humidTop[2], humidBottom[2], tempCond, humidCond, mode
}

// 0x09: GP, #afaeae
class AltMeshGPIO extends AltMeshBase {
    constructor(callback) {
        super('MESH-100GP');
        this.addEventListener('blocktypedetected', callback);
        this.addEventListener('notify', (data) => {
            // console.debug('>>>> notify', data);
            const id = [data.slice(0, 2), data.length].flat().toString();
            if (id === [0x01, 0x00, 5].toString()) {
                this.dispatchEvent('digitalchanged', {
                    event: 'digitalchanged',
                    pin: data[2],
                    edge: data[3],
                });
            }
            if (id === [0x01, 0x01, 7].toString()) {
                this.dispatchEvent('analogchanged', {
                    event: 'analogchanged',
                    pin: data[2],
                    level: data[5] / 255.0,
                });
            }
            if (id === [0x01, 0x02, 6].toString()) {
                this.dispatchEvent('digitalinput', {
                    event: 'digitalinput',
                    request_id: data[2],
                    pin: data[3],
                    level: (data[4] == 0x00),
                });
            }
            if (id === [0x01, 0x03, 7].toString()) {
                this.dispatchEvent('analoginput', {
                    event: 'analoginput',
                    request_id: data[2],
                    pin: data[3],
                    level: data[4] / 255.0,
                    mode: data[5],
                });
            }
            if (id === [0x01, 0x04, 6].toString()) {
                this.dispatchEvent('poweroutput', {
                    event: 'poweroutput',
                    request_id: data[2],
                    pin: data[3],
                    level: (data[4] != 0x00),
                });
            }
            if (id === [0x01, 0x05, 6].toString()) {
                this.dispatchEvent('digitaloutput', {
                    event: 'digitaloutput',
                    request_id: data[2],
                    pin: data[3],
                    level: (data[4] != 0x00),
                });
            }
            if (id === [0x01, 0x06, 6].toString()) {
                this.dispatchEvent('pwmoutput', {
                    event: 'pwmoutput',
                    request_id: data[2],
                    pin: data[3],
                    level: (data[4] / 255.0),
                });
            }
            // console.debug('<<<< notify');
        });
    }
    // GPIO write
    // - 入出力設定: 0x01, 0x01, digRisingEdge, digFallingEdge, dig, pwm, power, anaRisingEdge, anaFallingEdge, anaCond
    // - デジタル入力の状態通知設定: 0x01, 0x02, requestId, dig
    // - アナログ入力の状態通知設定: 0x01, 0x03, requestId, mode
    // - 電源出力の状態通知設定: 0x01, 0x04, requestId, 0x00
    // - デジタル出力の状態通知設定: 0x01, 0x05, requestId, dig 
    // - PWM 出力の状態通知設定: 0x01, 0x06, requestId, 0x02
}
