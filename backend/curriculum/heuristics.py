# Provides grandmaster-vetted pre-written coaching heuristics across chess archetypes
from typing import Dict, Any


_ARCHETYPE_KNOWLEDGE_BASE: Dict[str, Dict[str, Any]] = {
    "rook_endgame_activity": {
        "concept": "Failing to activate the rook to the 7th rank or behind passed pawns in open rook endgames.",
        "root_cause": "Passive defense syndrome: instinctively keeping pieces tethered to defending friendly pawns, failing to recognize that counter-attacking enemy pawns and cutting off the enemy king is the primary defensive weapon in rook endgames.",
        "signals": [
            "Can my rook invade the 7th or 8th rank to cut off the enemy king?",
            "Am I placing my rook behind the passed pawn (Tarrasch rule) rather than in front?",
            "Will this move generate active counter-threats, or does it surrender the initiative?"
        ],
        "guidance": "Start with simplified 3v3 king-and-rook theoretical endgames focusing on rook activity over pawn preservation. Progress to complex 4-rook asymmetric pawn majorities. Mastery is achieved when rook activation is prioritized instinctively over passive defense under time pressure."
    },
    "rook_activation_mid": {
        "concept": "Neglecting open and semi-open file occupation with rooks during middlegame transitions.",
        "root_cause": "Static piece placement: leaving heavy pieces on starting squares rather than anticipating central pawn breaks and clearing files for rook lifts and file dominance.",
        "signals": [
            "Is there an open or semi-open file that my rook can contest immediately?",
            "Can I double rooks on a central file before the pawn tension resolves?",
            "Am I moving to control critical file entry points, or merely shuffling passively?"
        ],
        "guidance": "Start with middlegames where central pawn trades are imminent to practice proactive file claiming. Progress to doubled-rook invasion and battery themes on the 7th rank. Mastery is achieved when rooks are seamlessly integrated into central attacking plans."
    },
    "isolated_pawn_handling": {
        "concept": "Mishandling isolated queen pawn structures by permitting piece blockades on d4/d5.",
        "root_cause": "Misjudging pawn structure dynamics: treating the isolated pawn as a passive liability rather than a dynamic spearhead that must be supported by active piece outposts or pushed as an opening break.",
        "signals": [
            "Can the opponent firmly blockade the square directly in front of my isolated pawn?",
            "Do I have active piece coordination (knights on central outposts, open c/e files) to justify the structural weakness?",
            "Is the central pawn advance available right now to trade off the structural weakness?"
        ],
        "guidance": "Start with isolated queen pawn positions practicing the d4-d5 / d5-d4 breakthrough. Progress to defending against the minority attack and controlling the blockading square. Mastery is achieved when dynamic compensation is converted into direct tactical initiative."
    },
    "king_safety_defense": {
        "concept": "Neglecting defensive piece coordination when facing pawn storms and kingside attacks.",
        "root_cause": "Delayed hazard perception: pursuing queenside pawn advances while opposing pieces are actively mobilizing towards the castled king's defensive shield.",
        "signals": [
            "Which opponent pieces can coordinate an attack against my king within the next two moves?",
            "Does my proposed move weaken the f7/f2, g7/g2, or h7/h2 defensive pawn structure?",
            "Can I reroute a piece to the 2nd/7th rank or centralize a knight to bolster king defense?"
        ],
        "guidance": "Start with classic attacking motifs (Greek gift sacrifices, rook lifts, h-file storms) to sharpen defensive anticipation. Progress to counter-striking in the center when attacked on the flank. Mastery is achieved when defensive reinforcements arrive before sacrifices land."
    },
    "tactical_awareness": {
        "concept": "Missing tactical combinations arising from loose pieces, pins, and overloaded defenders.",
        "root_cause": "Hope chess and blind spots: evaluating positions based on static plans without thoroughly calculating opponent forcing moves (checks, captures, and direct threats).",
        "signals": [
            "Are any of my pieces or the opponent's pieces currently unprotected (LPDO)?",
            "Are there alignment motifs: pieces on the same rank, file, or diagonal open to pins or skewers?",
            "What is my opponent's most aggressive, forcing reply to my move?"
        ],
        "guidance": "Start with single-theme tactical puzzles (pins, forks, removals of the guard). Progress to multi-move deflection and intermezzo combinations. Mastery is achieved when candidate checks and captures are scanned automatically before selecting any move."
    },
    "pawn_structure_weakness": {
        "concept": "Creating unnecessary pawn weaknesses (backward, doubled, and isolated pawns) without compensation.",
        "root_cause": "Impulsive pawn pushing: pushing pawns forward without realizing that pawns cannot move backward, leaving permanent outposts and weak color complexes for opponent pieces.",
        "signals": [
            "Will advancing this pawn create a backward pawn or concede an outpost square?",
            "Can my pieces defend the newly created dark-square or light-square holes?",
            "Does this pawn move serve a concrete purpose, or am I creating long-term structural targets?"
        ],
        "guidance": "Start with pawn endgame fundamentals understanding pawn islands and passed pawns. Progress to Carlsbad and French pawn structures. Mastery is achieved when every pawn push is calculated with respect to square control."
    },
    "piece_activity_central": {
        "concept": "Surrendering central influence by moving minor pieces to passive or rim squares.",
        "root_cause": "Fear of confrontation: tucking knights and bishops onto the edge of the board rather than asserting control over the critical e4/e5 and d4/d5 central squares.",
        "signals": [
            "Does this move increase or decrease the number of squares my piece actively controls?",
            "Am I placing a knight on the rim ('knight on the rim is dim') when a central outpost exists?",
            "Can this piece be centralized without immediately being chased away by enemy pawns?"
        ],
        "guidance": "Start with opening and early middlegame positions emphasizing classical central control. Progress to dynamic piece outposts in semi-open positions. Mastery is achieved when pieces are placed on maximally influential squares naturally."
    },
    "endgame_conversion": {
        "concept": "Failing to convert decisive material advantages into won endgames through king centralization.",
        "root_cause": "Passive king management: forgetting that in the endgame the king transforms from a liability that must hide into a powerful offensive piece that must actively march to the center.",
        "signals": [
            "Is my king actively marching towards the center and opposing the enemy king?",
            "Am I creating a passed pawn on the side with my pawn majority?",
            "Am I trading pieces while avoiding unnecessary pawn trades that lead to drawish endgames?"
        ],
        "guidance": "Start with fundamental king-and-pawn opposition drills. Progress to minor piece and rook conversion techniques. Mastery is achieved when theoretical winning margins are converted with clean, uncompromising technique."
    }
}


# Returns comprehensive coaching heuristics tailored to cluster archetype or features
def get_coaching_heuristics(cluster_label: str, display_name: str, feature_summary: dict = None) -> dict:
    clean_label = (cluster_label or "").strip().lower()
    for key, data in _ARCHETYPE_KNOWLEDGE_BASE.items():
        if key in clean_label or clean_label in key:
            return data

    disp_lower = (display_name or "").lower()
    for key, data in _ARCHETYPE_KNOWLEDGE_BASE.items():
        if any(w in disp_lower for w in key.split("_")):
            return data

    return {
        "concept": f"Consistent inaccuracy in {display_name.lower()} where passive piece placement forfeits the initiative.",
        "root_cause": f"The player tends to prioritize short-term comfort over active piece coordination, failing to recognize that tactical activity is the best defense in {display_name.lower()}.",
        "signals": [
            "Is there an open file, rank, or diagonal I can invade or control?",
            "Can I place this piece behind a passed pawn or into an active central outpost?",
            "Am I moving to attack a real target, or merely reacting passively to opponent moves?"
        ],
        "guidance": f"Start with simplified {display_name.lower()} positions focusing on immediate piece activation. Progress to complex counterplay scenarios where precise calculation is required. Mastery is achieved when active candidate moves are evaluated before passive alternatives under match pressure."
    }
