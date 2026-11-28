package io.github.dawartariq.printly.owner.nativeapp

import org.json.JSONObject

data class OwnerExperience(val notice: String? = null, val homeSubtitle: String? = null, val boardRefreshSeconds: Int = 15)

/** Remote presentation only: never treat this document as code or authority. */
internal fun parseOwnerExperience(json: JSONObject): OwnerExperience? {
    if (json.opt("schema") !is Int || json.optInt("schema") != 1) return null
    fun text(key: String, max: Int): String? {
        val value = json.opt(key) as? String ?: return null
        val trimmed = value.trim()
        return trimmed.takeIf { it.isNotEmpty() && it.length <= max && it.none { character -> Character.isISOControl(character) } }
    }
    val seconds = (json.opt("board_refresh_seconds") as? Int)?.takeIf { it in 10..60 } ?: 15
    return OwnerExperience(text("notice", 180), text("home_subtitle", 120), seconds)
}
