/** Khai báo kiểu cho `rijndael-js` 2.x (gói không kèm .d.ts). Chỉ phần đang dùng. */
declare module 'rijndael-js' {
  export default class Rijndael {
    constructor(key: Buffer | number[], mode: 'ecb' | 'cbc');
    /** blockSize tính bằng BIT (128/160/192/224/256). Trả mảng byte. */
    encrypt(plaintext: Buffer | number[], blockSize: number, iv?: Buffer | number[]): number[];
    decrypt(ciphertext: Buffer | number[], blockSize: number, iv?: Buffer | number[]): number[];
  }
}
