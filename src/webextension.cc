#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JSContextRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include <string.h>
#include "utils.h"

static WebKitWebExtension* extension_access;
static gchar* eventName = NULL;
static guint idLogHandler;

static void dispatch_ignore_event(WebKitWebPage* page, gchar* eventName, const gchar* uri) {
	gchar* ignoreName = g_strconcat("r", eventName, NULL);
	WebKitDOMDocument* document = webkit_web_page_get_dom_document(page);
	WebKitDOMDOMWindow* window = webkit_dom_document_get_default_view(document);
	GError* error = NULL;
	WebKitDOMEvent* event = webkit_dom_document_create_event(document, "KeyboardEvent", &error);
	if (error != NULL) {
		g_printerr("Cannot create event in dispatch_ignore_event: %s\n", error->message);
		g_error_free(error);
		return;
	}
	webkit_dom_keyboard_event_init_keyboard_event(
		(WebKitDOMKeyboardEvent*)event,	ignoreName,	FALSE, TRUE,
		window, uri, 0, FALSE, FALSE, FALSE, FALSE, FALSE
	);
	webkit_dom_event_target_dispatch_event(WEBKIT_DOM_EVENT_TARGET(window), event, &error);
	g_object_unref(window);
	g_object_unref(event);
	if (error != NULL) {
		g_printerr("Cannot dispatch event in dispatch_ignore_event: %s\n", error->message);
		g_error_free(error);
	}
}

static gboolean web_page_send_request(WebKitWebPage* page, WebKitURIRequest* request, WebKitURIResponse* redirected_response, gpointer data) {
	GError* error = NULL;
	gchar* eventName = (gchar*)data;
	const char* uri = webkit_uri_request_get_uri(request);
	SoupMessageHeaders* headers = webkit_uri_request_get_http_headers(request);

//	GVariantDict dictIn;
//	GVariant* variantIn = soup_headers_to_gvariant_dict(headers);
//	g_variant_dict_init(&dictIn, variantIn);
//	g_variant_dict_insert(&dictIn, "uri", "s", uri);

//	if (redirected_response != NULL) {
//		g_variant_dict_insert(&dictIn, "origuri", "s", webkit_uri_response_get_uri(redirected_response));
//	}

//	variantIn = g_variant_dict_end(&dictIn);

//	GVariant* tuple[1];
//	tuple[0] = variantIn;

////	guint64 startms = g_get_real_time();

//	// TODO send event to javascript world

//	g_variant_dict_clear(&dictIn);

//f
//	GVariantDict dictOut;
//	g_variant_dict_init(&dictOut, g_variant_get_child_value(results, 0));

//	const gchar* newuri = NULL;
//	const gchar* cancel = NULL;
//	const gchar* ignore = NULL;

	gboolean ret = FALSE;
//	if (g_variant_dict_lookup(&dictOut, "cancel", "s", &cancel)
//	&& cancel != NULL && !g_strcmp0(cancel, "1")) {
//		// returning TRUE blocks requests - it's better to set an empty uri - it sets status to 0;
//		webkit_uri_request_set_uri(request, "");
//	} else {
//		if (g_variant_dict_lookup(&dictOut, "uri", "s", &newuri) && newuri != NULL) {
//			webkit_uri_request_set_uri(request, newuri);
//		}
//		if (g_variant_dict_lookup(&dictOut, "ignore", "s", &ignore)
//		&& ignore != NULL && !g_strcmp0(ignore, "1")) {
//			dispatch_ignore_event(page, eventName, uri);
//		}
//	}

//	g_variant_dict_remove(&dictOut, "uri");

//	results = g_variant_dict_end(&dictOut);
//	update_soup_headers_with_dict(headers, results);
//	g_variant_unref(results);

//	g_message("elapsed %lu", g_get_real_time() - startms);

	return ret;
}


static void web_page_created_callback(WebKitWebExtension* extension, WebKitWebPage* web_page, gpointer data) {
	g_signal_handlers_disconnect_by_data(web_page, data);
	g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

static void ttyLog(const gchar *log_domain, GLogLevelFlags log_level, const gchar *message, gpointer user_data) {
	FILE* ftty = fopen("/dev/tty", "a");
	if (ftty == NULL) {
		return;
	}
	fprintf(ftty, "%s\n", message);
	fclose(ftty);
}

extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* extension, const GVariant* constData) {
		idLogHandler = g_log_set_handler(
			NULL,
			G_LOG_LEVEL_MASK,
			ttyLog,
			NULL
		);
		extension_access = extension;
		g_variant_get((GVariant*)constData, "(s)", &eventName);

		g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), eventName);
	}
}



static void __attribute__((destructor))
Webkit_Web_extension_shutdown (void) {
	g_object_unref(extension_access);

	g_signal_handlers_disconnect_by_data(extension_access, eventName);

	g_log_remove_handler(NULL, idLogHandler);

	eventName = NULL;
	extension_access = NULL;
}
