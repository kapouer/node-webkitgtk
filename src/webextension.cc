#include <dbus/dbus-glib.h>
#include <webkit2/webkit-web-extension.h>
#include <JavaScriptCore/JSContextRef.h>
#include <JavaScriptCore/JSStringRef.h>
#include <string.h>
#include "dbus.h"
#include "utils.h"

static GDBusConnection* connection;

static WebKitWebExtension* extension_access;
static gchar* eventName = NULL;
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
	// ignore redirected requests - it's transparent to the user
	if (redirected_response != NULL) {
		return FALSE;
	}
	gchar* eventName = (gchar*)data;
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
		g_printerr("ERR g_dbus_connection_call_sync %s\n", error->message);
		g_error_free(error);
		return FALSE;
	}

	GVariantDict dictOut;
	g_variant_dict_init(&dictOut, g_variant_get_child_value(results, 0));

	const gchar* newuri = NULL;
	const gchar* cancel = NULL;
	const gchar* ignore = NULL;

	gboolean ret = FALSE;
	if (g_variant_dict_lookup(&dictOut, "cancel", "s", &cancel)
	&& cancel != NULL && !g_strcmp0(cancel, "1")) {
		// returning TRUE blocks requests - it's better to set an empty uri - it sets status to 0;
		webkit_uri_request_set_uri(request, "");
	} else {
		if (g_variant_dict_lookup(&dictOut, "uri", "s", &newuri) && newuri != NULL) {
			webkit_uri_request_set_uri(request, newuri);
		}
		if (g_variant_dict_lookup(&dictOut, "ignore", "s", &ignore)
		&& ignore != NULL && !g_strcmp0(ignore, "1")) {
			dispatch_ignore_event(page, eventName, uri);
		}
	}

	g_variant_dict_remove(&dictOut, "uri");

	results = g_variant_dict_end(&dictOut);
	update_soup_headers_with_dict(headers, results);
	g_variant_unref(results);

	return ret;
}


static void web_page_created_callback(WebKitWebExtension* extension, WebKitWebPage* web_page, gpointer data) {
	g_signal_handlers_disconnect_by_data(web_page, data);
	g_signal_connect(web_page, "send-request", G_CALLBACK(web_page_send_request), data);
}

static gboolean event_listener(WebKitDOMDOMWindow* view, WebKitDOMEvent* event, gpointer data) {
	char* message = webkit_dom_keyboard_event_get_key_identifier((WebKitDOMKeyboardEvent*)event);
	GError* error = NULL;
	g_dbus_connection_call_sync(connection, NULL, DBUS_OBJECT_WKGTK, DBUS_INTERFACE_WKGTK,
		"NotifyEvent", g_variant_new("(s)", message), G_VARIANT_TYPE("()"), G_DBUS_CALL_FLAGS_NONE, -1, NULL,
		&error);
	if (error != NULL) {
		g_printerr("Failed to finish dbus call: %s\n", error->message);
		g_error_free(error);
	}
	g_free(message);
	return TRUE;
}

static void window_object_cleared_callback(WebKitScriptWorld* world, WebKitWebPage* page, WebKitFrame* frame, gchar* eventName) {
	WebKitDOMDocument* document = webkit_web_page_get_dom_document(page);
	WebKitDOMDOMWindow* window = webkit_dom_document_get_default_view(document);
	webkit_dom_event_target_add_event_listener(WEBKIT_DOM_EVENT_TARGET(window), eventName, G_CALLBACK(event_listener), false, NULL);
}

extern "C" {
	G_MODULE_EXPORT void webkit_web_extension_initialize_with_user_data(WebKitWebExtension* extension, const GVariant* constData) {

		extension_access = extension;
		gchar* address = NULL;
		g_variant_get((GVariant*)constData, "(ss)", &address, &eventName);

		g_signal_connect(webkit_script_world_get_default(), "window-object-cleared", G_CALLBACK(window_object_cleared_callback), eventName);

		g_signal_connect(extension, "page-created", G_CALLBACK(web_page_created_callback), eventName);

		GError* error = NULL;
		connection = g_dbus_connection_new_for_address_sync(address, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT, NULL, NULL, &error);
		if (connection == NULL) {
			g_printerr("Failed to open connection to bus: %s\n", error->message);
			g_error_free(error);
		}
	}
}



static void __attribute__((destructor))
Webkit_Web_extension_shutdown (void) {
	g_object_unref(extension_access);
	g_object_unref(connection);

	g_signal_handlers_disconnect_by_data(webkit_script_world_get_default(), eventName);
	g_signal_handlers_disconnect_by_data(extension_access, eventName);

	eventName = NULL;
	extension_access = NULL;
	connection = NULL;
}
