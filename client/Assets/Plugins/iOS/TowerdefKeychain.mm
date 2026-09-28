#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <stdlib.h>
#include <string.h>

// Credentials are not synchronized or migrated to another device.
static NSMutableDictionary *TDQuery(const char *key) {
    if (!key || !key[0]) return nil;
    NSString *account = [NSString stringWithUTF8String:key];
    if (!account) return nil;
    NSString *bundle = [[NSBundle mainBundle] bundleIdentifier];
    NSString *service = [(bundle ?: @"com.towerdef.mobile") stringByAppendingString:@".credentials"];
    return [NSMutableDictionary dictionaryWithDictionary:@{
        (__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService: service,
        (__bridge id)kSecAttrAccount: account,
        (__bridge id)kSecAttrSynchronizable: @NO
    }];
}

extern "C" int TDKeychainSet(const char *key, const char *value) {
    @autoreleasepool {
        NSMutableDictionary *query = TDQuery(key);
        if (!query || !value) return (int)errSecParam;
        NSData *data = [NSData dataWithBytes:value length:strlen(value)];
        NSDictionary *attributes = @{
            (__bridge id)kSecValueData: data,
            (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        };
        OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)attributes);
        if (status == errSecItemNotFound) {
            [query addEntriesFromDictionary:attributes];
            status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
        }
        return (int)status;
    }
}

// Caller must distinguish a missing item from denied/unavailable Keychain access.
extern "C" char *TDKeychainGet(const char *key, int *status) {
    @autoreleasepool {
        if (!status) return NULL;
        *status = (int)errSecParam;
        NSMutableDictionary *query = TDQuery(key);
        if (!query) return NULL;
        query[(__bridge id)kSecReturnData] = @YES;
        query[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        CFTypeRef result = NULL;
        *status = (int)SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
        if (*status != errSecSuccess || !result) {
            if (result) CFRelease(result);
            return NULL;
        }
        if (CFGetTypeID(result) != CFDataGetTypeID()) {
            CFRelease(result);
            *status = (int)errSecDecode;
            return NULL;
        }
        CFDataRef data = (CFDataRef)result;
        CFIndex length = CFDataGetLength(data);
        char *copy = (char *)malloc((size_t)length + 1);
        if (copy) {
            memcpy(copy, CFDataGetBytePtr(data), (size_t)length);
            copy[length] = '\0';
        } else {
            *status = (int)errSecAllocate;
        }
        CFRelease(result);
        return copy;
    }
}

extern "C" int TDKeychainDelete(const char *key) {
    @autoreleasepool {
        NSMutableDictionary *query = TDQuery(key);
        if (!query) return (int)errSecParam;
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query);
        return status == errSecItemNotFound ? (int)errSecSuccess : (int)status;
    }
}

extern "C" void TDKeychainFree(void *value) {
    free(value);
}
