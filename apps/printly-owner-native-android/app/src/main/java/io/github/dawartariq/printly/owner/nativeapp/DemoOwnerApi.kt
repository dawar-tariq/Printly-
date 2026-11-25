package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Synthetic data only. This source does not open sockets or connect to production. */
class DemoOwnerApi : OwnerApi {
    override val isDemo = true
    private var signedIn = false
    private val shop = JSONObject("""{"id":"33333333-3333-4333-8333-333333333333","name":"Bright Paper Studio","short_code":"DEMO","address":"12 Market Road","city":"Srinagar","phone":"","gstin":null,"upi_id":"demo@example","eta_minutes":20,"rush_surcharge_bps":0,"status":"active","kyc_status":"approved","is_open":true}""")
    private val services = JSONArray("""[{"service":"print","enabled":true},{"service":"photocopy","enabled":true},{"service":"scan","enabled":true},{"service":"bind","enabled":false},{"service":"laminate","enabled":false}]""")
    private val orders = mutableListOf(
        demoOrder("11111111-1111-4111-8111-111111111111", "A-104", "queued", "cod_pending", "cod", "Aisha K.", 2800),
        demoOrder("22222222-2222-4222-8222-222222222222", "A-103", "printing", "confirmed", "upi", "Rohan M.", 6400),
        demoOrder("44444444-4444-4444-8444-444444444444", "A-102", "ready", "cod_pending", "cod", "Sara P.", 1200),
        demoOrder("55555555-5555-4555-8555-555555555555", "", "draft", "submitted", "upi", "Neha R.", 3500),
    )
    private val stock = mutableListOf(
        JSONObject("""{"id":"66666666-6666-4666-8666-666666666666","name":"A4 paper","category":"paper","qty":420,"unit":"sheets","low_stock_threshold":100}"""),
        JSONObject("""{"id":"77777777-7777-4777-8777-777777777777","name":"Black toner","category":"ink","qty":2,"unit":"cartridges","low_stock_threshold":2}"""),
        JSONObject("""{"id":"88888888-8888-4888-8888-888888888888","name":"Spiral bindings","category":"binding","qty":35,"unit":"pieces","low_stock_threshold":10}"""),
    )
    private var rateRows = JSONArray("""[{"id":"99999999-9999-4999-8999-999999999999","service":"print","paper_size":"A4","color":"bw","sides":"single","paper_gsm":80,"option":null,"unit":"page","price_paise":200},{"id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","service":"print","paper_size":"A4","color":"color","sides":"single","paper_gsm":80,"option":null,"unit":"page","price_paise":1000}]""")
    private val purchases = mutableListOf<JSONObject>()

    override suspend fun restore() = false
    override suspend fun signIn(email: String, password: String) { signedIn = true }
    override suspend fun signOut(): Boolean { signedIn = false; return true }
    override suspend fun file(path: String): ByteArray = throw AppError("demo", "Sample mode does not contain real files.")
    override suspend fun requestWithProof(method: String, path: String, body: JSONObject, photo: ProofPhoto?): JSONObject = request(method, path, body)

    override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
        if (!signedIn) throw AppError("session_expired", "Please open the sample shop again.", 401)
        val clean = path.substringBefore('?')
        val result: JSONObject = when {
            clean == "me" && method == "GET" -> JSONObject().put("shop", shop).put("services", services).put("onboarding", JSONObject.NULL).put("is_owner", true)
            clean == "board" && method == "POST" -> board(body?.optString("search", "") ?: "")
            clean == "recovery" && method == "GET" -> JSONObject().put("orders", JSONArray(orders)).put("pagination", JSONObject().put("page", 1).put("pages", 1).put("count", orders.size))
            clean == "inventory" && method == "GET" -> JSONObject().put("items", JSONArray(stock))
            clean == "inventory" && method == "POST" -> {
                val item = JSONObject(requireNotNull(body).toString()).put("id", UUID.randomUUID().toString())
                stock.add(item); JSONObject().put("ok", true).put("id", item.getString("id"))
            }
            clean.startsWith("inventory/") && method == "PATCH" -> {
                val item = stock.firstOrNull { it.optString("id") == clean.substringAfter('/') } ?: throw AppError("not_found", "Item not found.", 404)
                val patch = requireNotNull(body)
                if (!matchesInventory(item, patch.optJSONObject("expected"))) throw AppError("stock_changed", "Stock changed. Refresh the item.", 409)
                for (key in listOf("name", "unit", "low_stock_threshold")) if (patch.has(key)) item.put(key, patch.get(key))
                if (patch.has("set_qty")) item.put("qty", patch.getDouble("set_qty"))
                if (patch.has("adjust")) item.put("qty", (item.optDouble("qty") + patch.getDouble("adjust")).coerceAtLeast(0.0))
                JSONObject().put("ok", true)
            }
            clean.startsWith("inventory/") && method == "DELETE" -> {
                val item = stock.firstOrNull { it.optString("id") == clean.substringAfter('/') } ?: throw AppError("not_found", "Item not found.", 404)
                if (!matchesInventory(item, requireNotNull(body).optJSONObject("expected"))) throw AppError("stock_changed", "Stock changed. Refresh the item.", 409)
                stock.remove(item); JSONObject().put("ok", true)
            }
            clean == "reports" && method == "GET" -> JSONObject("""{"orders_count":12,"revenue_paise":164000,"paid_orders_count":10,"avg_order_paise":16400,"service_counts":{"print":9,"photocopy":3},"series":[{"day":"Mon","revenue_paise":24000,"orders":2},{"day":"Tue","revenue_paise":35000,"orders":3},{"day":"Wed","revenue_paise":18000,"orders":1},{"day":"Thu","revenue_paise":41000,"orders":3},{"day":"Fri","revenue_paise":46000,"orders":3}]}""")
            clean == "rate-card" && method == "GET" -> JSONObject().put("rows", rateRows)
            clean.startsWith("rate-card/") && method == "PATCH" -> {
                val row = (0 until rateRows.length()).map { rateRows.getJSONObject(it) }.firstOrNull { it.optString("id") == clean.substringAfter('/') }
                    ?: throw AppError("not_found", "Rate not found.", 404)
                val input = requireNotNull(body)
                if (row.optInt("price_paise") != input.getJSONObject("expected").optInt("price_paise")) throw AppError("rate_changed", "Rate changed. Refresh it.", 409)
                row.put("price_paise", input.getInt("price_paise")); JSONObject().put("ok", true)
            }
            clean == "name-proof" && method == "POST" -> JSONObject().put("ok", true)
            clean == "settings" && method == "PUT" -> {
                val input = requireNotNull(body)
                val keys = input.keys(); while (keys.hasNext()) { val key = keys.next(); if (key != "services") shop.put(key, input.get(key)) }
                input.optJSONArray("services")?.let { updated ->
                    for (i in 0 until updated.length()) {
                        val row = updated.getJSONObject(i)
                        for (j in 0 until services.length()) if (services.getJSONObject(j).optString("service") == row.optString("service")) services.getJSONObject(j).put("enabled", row.optBoolean("enabled"))
                    }
                }
                JSONObject().put("ok", true).put("duplicate_name", false)
            }
            clean == "availability" && method == "PUT" -> { shop.put("is_open", requireNotNull(body).getBoolean("is_open")); JSONObject().put("is_open", shop.getBoolean("is_open")) }
            clean == "subscription" && method == "GET" -> subscription()
            clean == "subscription/status" && method == "GET" -> JSONObject().put("subscription", activeSubscription()).put("warning_days", 7)
            clean == "subscription" && method == "POST" -> subscriptionAction(requireNotNull(body))
            clean.startsWith("orders/") -> orderAction(method, clean.split('/'), body)
            else -> throw AppError("not_available", "This feature is not available in sample mode.", 404)
        }
        return JSONObject(result.toString())
    }

    private fun matchesInventory(item: JSONObject, expected: JSONObject?): Boolean = expected != null &&
        listOf("name", "category", "unit").all { item.optString(it) == expected.optString(it) } &&
        listOf("qty", "low_stock_threshold").all { item.optDouble(it, Double.NaN) == expected.optDouble(it, Double.NaN) }

    private fun board(search: String): JSONObject {
        val lanes = JSONObject()
        for (lane in listOf("confirm", "queued", "printing", "ready")) {
            val matching = orders.filter { order ->
                val belongs = if (lane == "confirm") order.optString("status") == "draft" else order.optString("status") == lane
                belongs && (search.isBlank() || order.optString("customer_name").contains(search, true) || order.optString("token").contains(search, true))
            }
            lanes.put(lane, JSONObject().put("orders", JSONArray(matching)).put("pagination", JSONObject().put("page", 1).put("pages", 1).put("count", matching.size)))
        }
        return JSONObject().put("shop_id", shop.getString("id")).put("lanes", lanes).put("completed_today", 4).put("attention", JSONArray())
    }

    private fun orderAction(method: String, parts: List<String>, body: JSONObject?): JSONObject {
        val item = orders.firstOrNull { it.optString("id") == parts.getOrNull(1) } ?: throw AppError("not_found", "Order not found.", 404)
        if (parts.size == 2 && method == "GET") {
            val line = JSONObject("""{"service":"print","copies":2,"pages":4,"paper_size":"A4","color":"bw","sides":"single","line_total_paise":2800}""")
            return JSONObject().put("order", item).put("items", JSONArray().put(line)).put("files", JSONArray()).put("events", JSONArray()).put("payment", JSONObject.NULL)
        }
        if (parts.size == 3 && method == "POST" && parts[2] == "status") {
            item.put("status", requireNotNull(body).getString("to"))
            return JSONObject().put("order", item)
        }
        if (parts.size == 3 && method == "POST" && parts[2] == "confirm-payment") {
            val input = requireNotNull(body)
            if (input.optString("action") == "confirm" && !input.optBoolean("verification_confirmed")) throw AppError("verification_required", "Check the transfer before confirming.", 422)
            item.put("status", if (input.optString("action") == "confirm") "queued" else "cancelled")
            item.put("payment_status", if (input.optString("action") == "confirm") "confirmed" else "rejected")
            return JSONObject().put("ok", true)
        }
        throw AppError("not_available", "This sample action is not available.", 404)
    }

    private fun activeSubscription() = JSONObject().put("term", "yearly").put("is_permanent", true).put("expires_at", JSONObject.NULL)
    private fun subscription() = JSONObject().put("shop", JSONObject().put("id", shop.getString("id")).put("name", shop.getString("name")).put("short_code", "DEMO"))
        .put("is_owner", true).put("subscription", activeSubscription())
        .put("plan", JSONObject("""{"monthly_paise":49900,"six_months_paise":249900,"yearly_paise":449900,"upi_id":"demo@example","payee_name":"Sample Printly","warning_days":7}"""))
        .put("purchases", JSONArray(purchases)).put("announcements", JSONArray()).put("offers_unavailable", false)

    private fun subscriptionAction(input: JSONObject): JSONObject {
        when (input.optString("action")) {
            "quote" -> {
                val term = input.optString("term")
                val amount = when (term) { "monthly" -> 49900; "six_months" -> 249900; else -> 449900 }
                val quote = JSONObject().put("term", term).put("base_paise", amount).put("monthly_reference_paise", JSONObject.NULL)
                    .put("discount_paise", 0).put("amount_paise", amount).put("promo_code", JSONObject.NULL).put("promo_id", JSONObject.NULL)
                    .put("promo_version", JSONObject.NULL).put("plan_version", 1).put("access_expires_at", JSONObject.NULL)
                return JSONObject().put("ok", true).put("result", quote)
            }
            "start" -> {
                val quote = input.getJSONObject("expected_quote")
                val purchase = JSONObject().put("id", UUID.randomUUID().toString()).put("term", input.getString("term"))
                    .put("amount_paise", quote.getLong("amount_paise")).put("status", "initiated")
                    .put("upi_id", "demo@example").put("payee_name", "Sample Printly").put("request_key", input.getString("request_key"))
                purchases.add(0, purchase)
                return JSONObject().put("ok", true).put("result", JSONObject().put("purchase", purchase))
            }
            "submit", "cancel" -> {
                val purchase = purchases.firstOrNull { it.optString("id") == input.optString("purchase_id") } ?: throw AppError("not_found", "Request not found.", 404)
                purchase.put("status", if (input.optString("action") == "submit") "submitted" else "cancelled")
                return JSONObject().put("ok", true).put("result", purchase)
            }
            else -> throw AppError("validation", "Invalid subscription action.", 422)
        }
    }

    companion object {
        private fun demoOrder(id: String, token: String, status: String, payment: String, method: String, name: String, amount: Int) =
            JSONObject().put("id", id).put("token", token).put("status", status).put("payment_status", payment)
                .put("payment_method", method).put("customer_name", name).put("customer_phone", "").put("total_paise", amount)
                .put("rush", false).put("created_at", "2026-01-01T10:00:00Z").put("utr", JSONObject.NULL).put("items", JSONArray().put(JSONObject().put("count", 1)))
    }
}
