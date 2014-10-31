#include <dbus/dbus-glib.h>
#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JSContextRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include <string.h>
#include "dbus.h"
#include "utils.h"

static GDBusConnection* connection;

static gboolean web_page_send_request(WebKitWebPage* web_page, WebKitURIRequest* request, WebKitURIResponse* redirected_response, gpointer data) {
	GError* error = NULL;
	// ignore redirected requests - it's transparent to the user
	if (redirected_response != NULL) {
		return FALSE;
	}
	const char* uri = webkit_uri_request_get_uri(request);
	SoupMessageHeaders* headers = webkit_uri_request_get_http_headers(request);

	GVariantDict dictIn;
	GVariant* variantIn = soup_headers_to_gvariant_dict(headers);
	g_variant_dict_init(&dictIn, variantIn);
	g_variant_dict_insert(&dictIn, "uri", "s", uri);
	variantIn = g_variant_dict_end(&dictIn);

	GVariant* tuple[1];
	tuple[0] = variantIn;

	GVariant* results = g_dbus_connection_call_sync(connection, NULL, DBUS_OBJECT_WKGTK, DBUS_INTERFACE_WKGTK, "HandleRequest", g_variant_new_tuple(tuple, 1), G_VARIANT_TYPE_TUPLE, G_DBUS_CALL_FLAGS_NONE, -1, NULL, &error);

	g_variant_dict_clear(&dictIn);

  if (results == NULL) {
		g_printerr("ERR THERE %s\n", error->message);
		g_error_free(error);
		return FALSE;
	}

	GVariantDict dictOut;
	g_variant_dict_init(&dictOut, g_variant_get_child_value(results, 0));

	bool ret = FALSE;
	const gchar* newuri = NULL;
	const gchar* cancel = NULL;
	if (g_variant_dict_lookup(&dictOut, "cancel", "s", &cancel) && cancel != NULL && !g_strcmp0(cancel, "1")) {
		ret = TRUE;
	} else if (g_variant_dict_lookup(&dictOut, "uri", "s", &newuri) && newuri != NULL) {
		webkit_uri_request_set_uri(request, newuri);
	}
	g_variant_dict_remove(&dictOut, "uri");

	results = g_variant_dict_end(&dictOut);
	update_soup_headers_with_dict(headers, results);
	g_variant_unref(results);

	return ret;
}


static void web_page_created_callback(WebKitWebExtension* extension, WebKitWebPage* web_page, gpointer data) {
	g_print("creatude");
	g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

static gboolean event_listener(WebKitDOMDOMWindow* view, WebKitDOMEvent* event, gpointer data) {
	// find a better way to exchange data between client and here. XHR ?
	// use CustomEvent, but how is it possible to get event->detail() ?
	char* message = webkit_dom_keyboard_event_get_key_identifier((WebKitDOMKeyboardEvent*)event);
	GError* error = NULL;
	g_dbus_connection_call_sync(connection, NULL, DBUS_OBJECT_WKGTK, DBUS_INTERFACE_WKGTK,
		"NotifyEvent", g_variant_new("(s)", message), G_VARIANT_TYPE("(s)"), G_DBUS_CALL_FLAGS_NONE, -1, NULL,
		&error);
	if (error != NULL) {
		g_printerr("Failed to finish dbus call: %s\n", error->message);
		g_error_free(error);
	}
	g_free(message);
	return TRUE;
}

static void window_object_cleared_callback(WebKitScriptWorld* world, WebKitWebPage* page, WebKitFrame* frame, gchar* eventName) {
	g_print("clearata");
	WebKitDOMDocument* document = webkit_web_page_get_dom_document(page);
	WebKitDOMDOMWindow* window = webkit_dom_document_get_default_view(document);
	webkit_dom_event_target_add_event_listener(WEBKIT_DOM_EVENT_TARGET(window), eventName, G_CALLBACK(event_listener), false, NULL);
}

extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* extension, const GVariant* constData) {
		gchar* address = NULL;
		gchar* eventName = NULL;
		g_variant_get((GVariant*)constData, "(ss)", &address, &eventName);

		g_signal_connect(webkit_script_world_get_default(), "window-object-cleared", G_CALLBACK(window_object_cleared_callback), eventName);

		g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), NULL);

		GError* error = NULL;
		connection = g_dbus_connection_new_for_address_sync(address, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT, NULL, NULL, &error);
		if (connection == NULL) {
			g_printerr("Failed to open connection to bus: %s\n", error->message);
      g_error_free(error);
    }
	}
}
