import { env, parseDataEncryptionKeyring } from '../config/env.config.js';
import { decryptValueWithKey, encryptValueWithKey } from './crypto.js';
import { deliveryEncryptionAad } from './domain.js';

export const DELIVERY_ENCRYPTION_VERSION = 2;

const LEGACY_DELIVERY_ENCRYPTION_VERSION = 1;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX_32_BYTE_PATTERN = /^[a-fA-F0-9]{64}$/;

export type DeliveryDriveUrlPersistence = {
  driveUrlCiphertext: string | null;
  driveUrlIv: string | null;
  driveUrlAuthTag: string | null;
  driveUrlKeyId: string | null;
  encryptionVersion: number;
};

export type DeliveryDriveUrlSource = DeliveryDriveUrlPersistence & {
  id: string;
};

export type DeliveryCryptographyConfig = {
  activeKeyId: string;
  keyring: Record<string, string>;
  legacyKey: string;
};

export const createDeliveryCryptography = (config: DeliveryCryptographyConfig) => {
  if (!KEY_ID_PATTERN.test(config.activeKeyId) || !HEX_32_BYTE_PATTERN.test(config.legacyKey)) {
    throw new Error('Teslimat encryption keyring yapılandırması geçersiz.');
  }

  const keyring = parseDataEncryptionKeyring(JSON.stringify(config.keyring));
  if (!keyring[config.activeKeyId]) {
    throw new Error('Aktif teslimat encryption key keyring içinde bulunamadı.');
  }

  const buildDriveUrlData = (
    deliveryId: string,
    driveUrl: string | null,
  ): DeliveryDriveUrlPersistence => {
    if (!deliveryId) throw new Error('Teslimat şifreleme bağlamı geçersiz.');
    if (driveUrl === null) {
      return {
        driveUrlCiphertext: null,
        driveUrlIv: null,
        driveUrlAuthTag: null,
        driveUrlKeyId: null,
        encryptionVersion: DELIVERY_ENCRYPTION_VERSION,
      };
    }

    const encrypted = encryptValueWithKey(
      driveUrl,
      keyring[config.activeKeyId]!,
      deliveryEncryptionAad(deliveryId),
    );
    return {
      driveUrlCiphertext: encrypted.ciphertext,
      driveUrlIv: encrypted.iv,
      driveUrlAuthTag: encrypted.authTag,
      driveUrlKeyId: config.activeKeyId,
      encryptionVersion: DELIVERY_ENCRYPTION_VERSION,
    };
  };

  const decryptDriveUrl = (source: DeliveryDriveUrlSource): string | null => {
    if (!source.id) throw new Error('Teslimat şifreleme bağlamı geçersiz.');
    const encryptedParts = [
      source.driveUrlCiphertext,
      source.driveUrlIv,
      source.driveUrlAuthTag,
    ];
    if (encryptedParts.every((part) => part === null)) {
      if (source.driveUrlKeyId !== null) {
        throw new Error('Teslimat şifreli veri zarfı eksik.');
      }
      return null;
    }
    if (encryptedParts.some((part) => part === null)) {
      throw new Error('Teslimat şifreli veri zarfı eksik.');
    }
    if (
      source.encryptionVersion !== LEGACY_DELIVERY_ENCRYPTION_VERSION &&
      source.encryptionVersion !== DELIVERY_ENCRYPTION_VERSION
    ) {
      throw new Error('Desteklenmeyen teslimat encryption sürümü.');
    }

    let key: string;
    if (source.driveUrlKeyId === null) {
      key = config.legacyKey;
    } else {
      if (
        source.encryptionVersion !== DELIVERY_ENCRYPTION_VERSION ||
        !KEY_ID_PATTERN.test(source.driveUrlKeyId)
      ) {
        throw new Error('Teslimat şifreli veri zarfı geçersiz.');
      }
      const exactKey = keyring[source.driveUrlKeyId];
      if (!exactKey) throw new Error('Teslimat encryption key keyring içinde bulunamadı.');
      key = exactKey;
    }

    return decryptValueWithKey(
      {
        ciphertext: source.driveUrlCiphertext!,
        iv: source.driveUrlIv!,
        authTag: source.driveUrlAuthTag!,
      },
      key,
      source.encryptionVersion === DELIVERY_ENCRYPTION_VERSION
        ? deliveryEncryptionAad(source.id)
        : undefined,
    );
  };

  return Object.freeze({ buildDriveUrlData, decryptDriveUrl });
};

export const deliveryCryptography = createDeliveryCryptography({
  activeKeyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
  keyring: parseDataEncryptionKeyring(env.DATA_ENCRYPTION_KEYRING_JSON),
  legacyKey: env.DATA_ENCRYPTION_KEY,
});

export const buildDeliveryDriveUrlData = (
  deliveryId: string,
  driveUrl: string | null,
): DeliveryDriveUrlPersistence => deliveryCryptography.buildDriveUrlData(deliveryId, driveUrl);

export const decryptDeliveryDriveUrl = (source: DeliveryDriveUrlSource): string | null =>
  deliveryCryptography.decryptDriveUrl(source);
