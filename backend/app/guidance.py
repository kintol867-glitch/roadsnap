"""
Damage labels and road-safety guidance.

- friendly_damage_type(): turns RDD2022 class codes (D00, D10, D20, D40)
  into readable names.
- get_recommendation(): returns a headline plus a list of tips for motorists
  and local authorities, based on damage type and severity.

This is general road-safety guidance, not an engineering assessment.
"""

DAMAGE_LABELS = {
    "D00": "longitudinal crack",
    "D10": "transverse crack",
    "D20": "alligator crack",
    "D40": "pothole",
}

SEVERITY_GUIDANCE = {
    "Severe": {
        "headline": "High risk: avoid this stretch if you can.",
        "tips": [
            "Use the suggested alternate route if one is shown.",
            "If you must pass, slow down early and avoid sudden braking or swerving.",
            "Motorcycle and bicycle riders should avoid it, especially at night or when the road is wet.",
            "Barangay/LGU: place warning signs or cones and prioritize urgent repair.",
        ],
    },
    "Moderate": {
        "headline": "Caution: drive carefully through this area.",
        "tips": [
            "Reduce speed and keep a safe distance from the vehicle ahead.",
            "Watch for other drivers swerving around the damage.",
            "Barangay/LGU: schedule repair soon, before the damage worsens.",
        ],
    },
    "Minor": {
        "headline": "Low risk: stay alert.",
        "tips": [
            "Keep a steady speed and watch the road surface.",
            "Barangay/LGU: monitor it and include it in routine maintenance.",
        ],
    },
    "None": {
        "headline": "No damage detected in this photo.",
        "tips": [
            "If damage is visible, retake the photo in good light, closer to the damage, with the road surface filling most of the frame.",
        ],
    },
}

TYPE_GUIDANCE = {
    "pothole": "Water can hide how deep a pothole is, so treat puddles on damaged roads with caution.",
    "alligator crack": "Alligator cracking often means the road base is weakening and can break into potholes, especially after rain.",
    "longitudinal crack": "Avoid riding with a wheel along the crack line, since water can seep in and widen it.",
    "transverse crack": "Slow down before crossing cracks that run across the lane, especially on two-wheelers.",
    "crack": "Cracks let water into the road base; slow down and avoid riding along the crack line.",
    "surface wear": "Worn surfaces can be loose or slippery; allow a longer braking distance, especially when wet.",
}


def friendly_damage_type(raw_name):
    """Map a model class code (e.g. 'D40') to a readable name; pass other names through."""
    return DAMAGE_LABELS.get(raw_name, raw_name)


def get_recommendation(damage_type, severity):
    base = SEVERITY_GUIDANCE.get(severity, SEVERITY_GUIDANCE["None"])
    tips = list(base["tips"])
    extra = TYPE_GUIDANCE.get(friendly_damage_type(damage_type or "").lower())
    if extra and severity != "None":
        tips.append(extra)
    return {"headline": base["headline"], "tips": tips}

def recommendation_for(detection):
    """Build a recommendation from a detection dict (or None if there isn't one)."""
    if not detection:
        return None
    return get_recommendation(detection.get("damage_type"), detection.get("severity"))