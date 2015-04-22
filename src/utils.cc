#include "utils.h"

gchar* getStr(Handle<Object> opts, const gchar* name) {
	NanUtf8String* str = NULL;
	if (opts->Has(H(name))) {
		Handle<Value> opt = opts->Get(H(name));
		if (opt->IsString()) {
			str = new NanUtf8String(opt);
		}
	}
	if (str != NULL && str->length() > 1) {
		return **str;
	} else {
		return NULL;
	}
}

NanCallback* getCb(Handle<Object> opts, const gchar* name) {
	NanCallback* cb = NULL;
	if (opts->Has(H(name))) {
		Handle<Value> opt = opts->Get(H(name));
		if (opt->IsFunction()) {
			cb = new NanCallback(opt.As<Function>());
		}
	}
	return cb;
}

// actually, the dict is a (key, arrayOfStrings) map
void update_soup_headers_with_dict(SoupMessageHeaders* headers, GVariant* dict) {
	if (headers == NULL) return;
	GVariantIter iter;
	GVariant* val = NULL;
	gchar* key;

	g_variant_iter_init(&iter, dict);
	while (g_variant_iter_next(&iter, "{sv}", &key, &val)) {
		if (val == NULL) {
			soup_message_headers_remove(headers, key);
		} else {
			soup_message_headers_replace(headers, key, g_variant_get_string(val, NULL));
		}
		g_variant_unref(val);
		g_free(key);
	}
}

GVariant* soup_headers_to_gvariant_dict(SoupMessageHeaders* headers) {
	GVariantBuilder builder;
	g_variant_builder_init(&builder, G_VARIANT_TYPE_VARDICT);
	if (headers != NULL) {
		SoupMessageHeadersIter iter;
		soup_message_headers_iter_init(&iter, headers);
		while (true) {
			const char* name;
			const char* value;
			if (!soup_message_headers_iter_next(&iter, &name, &value)) break;
			g_variant_builder_add(&builder, "{sv}", name, g_variant_new_string(value));
		}
	}
	return g_variant_builder_end(&builder);
}

