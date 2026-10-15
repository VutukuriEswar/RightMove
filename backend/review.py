# Provides review-match classification, accuracy, reports and PDF
import io
import math
import os
import chess
import chess.pgn
# Converts centipawn score to win probability
def eval_to_win_prob(centipawns: float) -> float:
    try:
        cp = float(centipawns or 0.0)
    except Exception:
        cp = 0.0
    if cp > 2000:
        cp = 2000.0
    if cp < -2000:
        cp = -2000.0
    return 1.0 / (1.0 + math.pow(10, -cp / 400.0))


# Converts win probability percent to accuracy
def accuracy_from_wp_diff(wp_before: float, wp_after: float) -> float:
    try:
        diff = max(0.0, float(wp_before) - float(wp_after))
    except Exception:
        diff = 0.0
    acc = 103.1668 * math.exp(-0.04354 * diff) - 3.1669
    return round(max(0.0, min(100.0, acc)), 1)


# Classifies move from centipawn loss and best-move match
def classify_loss(cp_loss: float, is_best: bool = False, is_capture_sac: bool = False) -> str:
    try:
        loss = max(0.0, float(cp_loss or 0.0))
    except Exception:
        loss = 0.0
    if is_best or loss <= 0.5:
        return "best"
    if is_capture_sac:
        return "brilliant"
    if loss <= 20:
        return "best"
    if loss <= 50:
        return "excellent"
    if loss <= 110:
        return "good"
    if loss <= 220:
        return "inaccuracy"
    if loss <= 420:
        return "mistake"
    return "blunder"


# Classifies move from win-probability swing
def classify_move(eval_before_cp: float, eval_after_cp: float, is_white_to_move: bool,
                  is_capture: bool = False, best_move_cp=None) -> str:
    try:
        eb = float(eval_before_cp or 0.0)
        ea = float(eval_after_cp or 0.0)
    except Exception:
        return "good"
    if is_white_to_move:
        wp_before = eval_to_win_prob(eb)
        wp_after = eval_to_win_prob(ea)
    else:
        wp_before = eval_to_win_prob(-eb)
        wp_after = eval_to_win_prob(-ea)
    delta = wp_before - wp_after
    is_best = bool(best_move_cp is not None and abs(ea - float(best_move_cp)) < 10)
    if is_best and delta <= 0.005:
        return "best"
    if (is_capture is False and best_move_cp is not None
            and abs(ea - float(best_move_cp)) < 10 and ea > eb):
        return "brilliant"
    if delta < 0.01:
        return "best"
    if delta < 0.03:
        return "excellent"
    if delta < 0.06:
        return "good"
    if delta < 0.12:
        return "inaccuracy"
    if delta < 0.22:
        return "mistake"
    return "blunder"


# Averages per-move accuracy scores
def game_accuracy(move_scores: list) -> float:
    vals = [float(v) for v in (move_scores or []) if isinstance(v, (int, float)) and v == v]
    if not vals:
        return 0.0
    return round(sum(vals) / len(vals), 1)


# Averages accuracy for one color from analyzed moves
def color_accuracy(moves: list, color: str) -> float:
    want_white = str(color or "").lower() == "white"
    vals = []
    for m in (moves or []):
        try:
            turn = str(m.get("turn", "")).lower()
            is_white = turn == "white" if turn else (int(m.get("ply", 1)) % 2 == 1)
        except Exception:
            is_white = True
        if is_white != want_white:
            continue
        s = m.get("accuracy_score", None)
        if isinstance(s, (int, float)) and s == s:
            vals.append(float(s))
    if not vals:
        return 0.0
    return round(sum(vals) / len(vals), 1)


# Counts classifications by label
def count_labels(moves: list) -> dict:
    counts = {"brilliant": 0, "best": 0, "excellent": 0, "good": 0,
              "inaccuracy": 0, "mistake": 0, "blunder": 0}
    for m in (moves or []):
        c = str(m.get("classification", "good")).lower()
        if c == "best_move":
            c = "best"
        if c in counts:
            counts[c] += 1
        else:
            counts["good"] += 1
    counts["total_moves"] = len(moves or [])
    return counts


# Assigns letter grade from accuracy
def grade_for(accuracy: float) -> str:
    try:
        a = float(accuracy or 0.0)
    except Exception:
        a = 0.0
    if a >= 95:
        return "A+"
    if a >= 90:
        return "A"
    if a >= 85:
        return "A-"
    if a >= 80:
        return "B+"
    if a >= 75:
        return "B"
    if a >= 70:
        return "C"
    if a >= 55:
        return "D"
    return "Needs Improvement"


try:
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
    from reportlab.lib.styles import getSampleStyleSheet
    REPORTLAB_AVAILABLE = True
except ImportError:
    REPORTLAB_AVAILABLE = False


from core import GameSummaryDoc, KeyMoment


# Averages classification labels with weights
def accuracy_from_classifications(classifications):
    if not classifications:
        return 100.0
    weights = {
        "brilliant": 100,
        "best": 100,
        "best_move": 100,
        "excellent": 90,
        "good": 75,
        "inaccuracy": 50,
        "mistake": 25,
        "blunder": 0,
    }
    total = sum(weights.get(str(c).lower(), 75) for c in classifications)
    return round(total / len(classifications), 1)


# Section services/summary_service

# Builds game summary from annotated moves
def generate_summary(
    game_id: str,
    moves_data: list[dict],
    white_username: str = "White",
    black_username: str = "Black",
) -> GameSummaryDoc:
    white_classifications = []
    black_classifications = []
    key_moments: list[KeyMoment] = []

    for move in moves_data:
        is_white = move.get("is_white", move["ply"] % 2 == 1)
        classification = classify_move(
            eval_before_cp=move.get("eval_before_cp", 0),
            eval_after_cp=move.get("eval_after_cp", 0),
            is_white_to_move=is_white,
            is_capture=move.get("is_capture", False),
            best_move_cp=move.get("best_move_cp"),
        )

        if is_white:
            white_classifications.append(classification)
        else:
            black_classifications.append(classification)

        eval_before = move.get("eval_before_cp", 0)
        eval_after = move.get("eval_after_cp", 0)
        wp_before = eval_to_win_prob(eval_before if is_white else -eval_before)
        wp_after = eval_to_win_prob(eval_after if is_white else -eval_after)
        delta = abs(wp_before - wp_after)

        if delta > 0.15 or classification in ("blunder", "mistake"):
            key_moments.append(KeyMoment(
                ply=move["ply"],
                san=move["san"],
                eval_before_cp=eval_before,
                eval_after_cp=eval_after,
                delta_win_prob=round(delta, 4),
                classification=classification,
            ))

    key_moments.sort(key=lambda km: km.delta_win_prob, reverse=True)
    key_moments = key_moments[:3]

    accuracy_white = accuracy_from_classifications(white_classifications)
    accuracy_black = accuracy_from_classifications(black_classifications)

    summary_text = _write_summary(
        white_username, black_username,
        accuracy_white, accuracy_black,
        white_classifications, black_classifications,
        key_moments,
    )

    return GameSummaryDoc(
        game_id=game_id,
        accuracy_white=accuracy_white,
        accuracy_black=accuracy_black,
        summary_text=summary_text,
        key_moments=key_moments,
    )

# Writes summary narrative from moments
def _write_summary(
    white_name: str,
    black_name: str,
    acc_white: float,
    acc_black: float,
    white_cls: list[str],
    black_cls: list[str],
    key_moments: list[KeyMoment],
) -> str:
    lines = []

    lines.append(
        f"**Game Summary**\n\n"
        f"{white_name} played with {acc_white}% accuracy; "
        f"{black_name} played with {acc_black}% accuracy."
    )

    w_blunders = white_cls.count("blunder")
    b_blunders = black_cls.count("blunder")
    w_mistakes = white_cls.count("mistake")
    b_mistakes = black_cls.count("mistake")

    if w_blunders or w_mistakes:
        lines.append(
            f"\n**{white_name}** made {w_blunders} blunder(s) and {w_mistakes} mistake(s). "
            + _improvement_note(white_cls)
        )
    if b_blunders or b_mistakes:
        lines.append(
            f"\n**{black_name}** made {b_blunders} blunder(s) and {b_mistakes} mistake(s). "
            + _improvement_note(black_cls)
        )

    if key_moments:
        lines.append("\n**Key turning points:**")
        for km in key_moments:
            lines.append(
                f"  • Move {(km.ply + 1) // 2} ({km.san}): "
                f"{km.classification.capitalize()} — eval shifted by "
                f"{km.delta_win_prob:.0%} in win probability."
            )

    return "\n".join(lines)

# Generates improvement hint from error patterns
def _improvement_note(classifications: list[str]) -> str:
    blunders = classifications.count("blunder")
    mistakes = classifications.count("mistake")
    inaccuracies = classifications.count("inaccuracy")

    if blunders >= 3:
        return "Consider spending more time calculating forcing lines before committing to a move."
    elif mistakes >= 3:
        return "Focus on double-checking your moves for simple tactical responses (forks, pins, skewers)."
    elif inaccuracies >= 5:
        return "The move quality is close but drifting — try to identify the single best plan before each move."
    else:
        return "Review the highlighted moments in the move list to see where the game turned."


# Summarizes game results into report
class GameReport:

    # Summarizes move results into overview
    @staticmethod
    def summarize(results):
        summary = count_labels(results)
        total_cp_loss = 0.0
        for move in (results or []):
            try:
                total_cp_loss += float(move.get("cp_loss", 0.0) or 0.0)
            except Exception:
                pass
        summary["total_moves"] = len(results or [])
        summary["average_cp_loss"] = round(total_cp_loss / len(results), 2) if results else 0
        return summary

    # Calculates accuracy score from results
    @staticmethod
    def accuracy_score(results):
        scores = []
        for m in (results or []):
            s = (m or {}).get("accuracy_score", None)
            if isinstance(s, (int, float)) and s == s:
                scores.append(float(s))
        if scores:
            return game_accuracy(scores)
        counts = count_labels(results)
        weights = {"brilliant": 100, "best": 100, "excellent": 90, "good": 75,
                   "inaccuracy": 50, "mistake": 25, "blunder": 0}
        total = sum(counts.get(k, 0) * w for k, w in weights.items())
        n = max(1, counts.get("total_moves", 0))
        return round(total / n, 2)

    # Calculates per-color accuracy from results
    @staticmethod
    def color_accuracy(results, color):
        return color_accuracy(results, color)

    # Assigns grade from accuracy score
    @staticmethod
    def grade(accuracy):
        return grade_for(accuracy)

# Generates narrative summary from report
class GameSummary:

    # Generates narrative summary from report
    @staticmethod
    def generate(report):
        text = []
        text.append(
            f"You made {report['blunders']} blunders, "
            f"{report['mistakes']} mistakes and "
            f"{report['inaccuracies']} inaccuracies."
        )
        weaknesses = report["weaknesses"]
        if weaknesses:
            text.append("Primary improvement areas:")
            for weakness in weaknesses:
                text.append(f"- {weakness}")
        else:
            text.append("No major recurring weakness detected.")
        return "\n".join(text)

# Detects recurring weaknesses from moves
class WeaknessDetector:

    # Detects weaknesses from move results
    @staticmethod
    def detect(move_results):
        weaknesses = []
        inaccuracies = 0
        mistakes = 0
        blunders = 0
        development_errors = 0
        center_errors = 0
        king_safety_errors = 0

        for move in move_results:
            category = move["classification"]
            if category == "inaccuracy":
                inaccuracies += 1
            elif category == "mistake":
                mistakes += 1
            elif category == "blunder":
                blunders += 1

            for concept in move.get("concepts", []):
                concept = concept.lower()
                if "development" in concept:
                    development_errors += 1
                elif "center" in concept:
                    center_errors += 1
                elif "king" in concept:
                    king_safety_errors += 1

        if development_errors >= 3:
            weaknesses.append("Development")
        if center_errors >= 3:
            weaknesses.append("Center Control")
        if king_safety_errors >= 3:
            weaknesses.append("King Safety")

        return {"inaccuracies": inaccuracies, "mistakes": mistakes, "blunders": blunders, "weaknesses": weaknesses}

# Analyzes player style from moves
class StyleAnalyzer:

    # Analyzes style from move results
    @staticmethod
    def analyze(move_results):
        aggressive = 0
        positional = 0
        defensive = 0

        for move in move_results:
            raw_concepts = move.get("concepts", [])
            concepts = [str(c).lower() for c in raw_concepts]

            if any("attack" in c or "initiative" in c for c in concepts):
                aggressive += 1
            if any("center" in c or "central" in c or "development" in c or "space" in c for c in concepts):
                positional += 1
            if any("king safety" in c or "defense" in c or "castl" in c for c in concepts):
                defensive += 1

        scores = {"Aggressive": aggressive, "Positional": positional, "Defensive": defensive}
        style = max(scores, key=scores.get)
        return {"style": style, "type": style, "scores": scores}

# Generates training plan from weaknesses
class TrainingPlan:

    # Generates training plan from weaknesses
    @staticmethod
    def generate(weaknesses):
        recommendations = []

        for weakness in weaknesses:
            if weakness == "Development":
                recommendations.append({
                    "topic": "Development",
                    "daily_minutes": 20,
                    "advice": "Develop knights and bishops before launching attacks.",
                    "exercise": "Play 10 opening positions focusing on rapid development.",
                })
            elif weakness == "Center Control":
                recommendations.append({
                    "topic": "Center Control",
                    "daily_minutes": 20,
                    "advice": "Fight for e4, d4, e5 and d5 squares.",
                    "exercise": "Review classical openings and identify center-controlling moves.",
                })
            elif weakness == "King Safety":
                recommendations.append({
                    "topic": "King Safety",
                    "daily_minutes": 20,
                    "advice": "Castle earlier and avoid weakening your king.",
                    "exercise": "Analyze 5 games where delayed castling caused problems.",
                })

        if not recommendations:
            recommendations.append({
                "topic": "General Improvement",
                "daily_minutes": 15,
                "advice": "Continue playing and reviewing games.",
                "exercise": "Analyze one game daily.",
            })

        return recommendations

# Recommends openings for player style
class OpeningRecommender:

    # Recommends opening for style
    @staticmethod
    def recommend(player_style):
        openings = {
            "Aggressive": ["Sicilian Defense", "King's Indian Defense", "Vienna Game"],
            "Positional": ["Queen's Gambit", "Ruy Lopez", "Catalan Opening"],
            "Defensive": ["Caro-Kann Defense", "French Defense", "London System"],
        }
        return openings.get(player_style, ["Italian Game", "London System"])

# Detects opening from PGN path
class OpeningDetector:

    OPENINGS = {
        "e4 e5 Nf3 Nc6 Bc4": "Italian Game",
        "e4 e5 Nf3 Nc6 Bb5": "Ruy Lopez",
        "d4 d5 c4": "Queen's Gambit",
        "d4 Nf6 Bf4": "London System",
        "e4 c5": "Sicilian Defense",
        "e4 e6": "French Defense",
        "e4 c6": "Caro-Kann Defense",
        "d4 Nf6 c4 g6": "King's Indian Defense",
        "d4 Nf6 c4 e6 Nc3 Bb4": "Nimzo-Indian Defense",
    }

    # Detects opening from PGN file
    @staticmethod
    def detect(pgn_path):
        try:
            with open(pgn_path, encoding="utf-8") as pgn_file:
                game = chess.pgn.read_game(pgn_file)
            if game is None:
                return "Unknown Opening"
            return OpeningDetector.detect_game(game)
        except Exception:
            return "Unknown Opening"

    # Detects opening from PGN text
    @staticmethod
    def detect_text(pgn_text):
        try:
            game = chess.pgn.read_game(io.StringIO(pgn_text or ""))
            if game is None:
                return "Unknown Opening"
            return OpeningDetector.detect_game(game)
        except Exception:
            return "Unknown Opening"

    # Detects opening from parsed game
    @staticmethod
    def detect_game(game):
        try:
            board = game.board()
            san_moves = []
            for move in game.mainline_moves():
                san_moves.append(board.san(move))
                board.push(move)
                current_line = " ".join(san_moves)
                for pattern, opening in OpeningDetector.OPENINGS.items():
                    if current_line.startswith(pattern):
                        return opening
                if len(san_moves) >= 10:
                    break
            return "Unknown Opening"
        except Exception:
            return "Unknown Opening"


# Generates PDF report from data
class PDFReport:

    # Builds branded stylesheet matching site theme
    @staticmethod
    def _styles():
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_LEFT, TA_CENTER
        base = getSampleStyleSheet()
        ink = "#1C1008"
        gold = "#8B2500"
        brass = "#5A3E25"
        s = {}
        s["cover_title"] = ParagraphStyle("cover_title", parent=base["Title"], fontName="Times-Bold",
                                          fontSize=26, leading=30, textColor=ink, alignment=TA_CENTER, spaceAfter=4)
        s["cover_sub"] = ParagraphStyle("cover_sub", parent=base["Normal"], fontName="Times-Italic",
                                        fontSize=11, leading=15, textColor=brass, alignment=TA_CENTER, spaceAfter=2)
        s["h1"] = ParagraphStyle("h1", parent=base["Heading1"], fontName="Times-Bold",
                                 fontSize=15, leading=18, textColor=ink, spaceBefore=14, spaceAfter=8,
                                 borderPadding=(0, 0, 4, 0))
        s["h2"] = ParagraphStyle("h2", parent=base["Heading2"], fontName="Times-Bold",
                                 fontSize=12, leading=15, textColor=gold, spaceBefore=10, spaceAfter=6)
        s["h3"] = ParagraphStyle("h3", parent=base["Heading3"], fontName="Times-Bold",
                                 fontSize=10, leading=13, textColor=ink, spaceBefore=6, spaceAfter=4)
        s["body"] = ParagraphStyle("body", parent=base["BodyText"], fontName="Times-Roman",
                                   fontSize=9.5, leading=14, textColor=ink, spaceAfter=4)
        s["small"] = ParagraphStyle("small", parent=base["BodyText"], fontName="Times-Roman",
                                    fontSize=8.5, leading=12, textColor=brass, spaceAfter=2)
        s["cell"] = ParagraphStyle("cell", parent=base["BodyText"], fontName="Times-Roman",
                                   fontSize=8.5, leading=11, textColor=ink)
        s["cell_bold"] = ParagraphStyle("cell_bold", parent=s["cell"], fontName="Times-Bold")
        s["center"] = ParagraphStyle("center", parent=s["body"], alignment=TA_CENTER)
        s["left"] = ParagraphStyle("left", parent=s["body"], alignment=TA_LEFT)
        return s

    # Draws header footer and page number
    @staticmethod
    def _chrome(canvas, doc):
        canvas.saveState()
        canvas.setFont("Times-Roman", 8)
        canvas.setFillColorRGB(0.35, 0.24, 0.15)
        canvas.drawString(doc.leftMargin, doc.height + doc.topMargin + 6, "RightMove  |  AI Chess Coach Report")
        canvas.drawRightString(doc.width + doc.leftMargin, 28, f"Page {doc.page}")
        canvas.setStrokeColorRGB(0.78, 0.66, 0.42)
        canvas.setLineWidth(0.75)
        canvas.line(doc.leftMargin, 34, doc.width + doc.leftMargin, 34)
        canvas.restoreState()

    # Draws cover header band
    @staticmethod
    def _cover_band(canvas, doc):
        if doc.page != 1:
            PDFReport._chrome(canvas, doc)
            return
        canvas.saveState()
        canvas.setFillColorRGB(0.11, 0.06, 0.03)
        canvas.rect(0, doc.height + doc.topMargin - 6, doc.width + doc.leftMargin + doc.rightMargin, 54, fill=1, stroke=0)
        canvas.setFillColorRGB(0.83, 0.69, 0.22)
        canvas.setFont("Times-Bold", 11)
        canvas.drawCentredString(doc.width / 2 + doc.leftMargin, doc.height + doc.topMargin + 28, "RIGHTMOVE  CHESS  ACADEMY")
        canvas.setFont("Times-Roman", 8)
        canvas.setFillColorRGB(0.96, 0.93, 0.85)
        canvas.drawCentredString(doc.width / 2 + doc.leftMargin, doc.height + doc.topMargin + 14, "Play  -  Learn  -  Analyze")
        canvas.restoreState()

    # Generates PDF file from report data
    @staticmethod
    def generate(output_path, report_data):
        if not REPORTLAB_AVAILABLE:
            raise RuntimeError("reportlab is not installed. Install with: pip install reportlab")
        from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak,
                                        Table, TableStyle, HRFlowable, KeepTogether)
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.units import mm

        dir_name = os.path.dirname(output_path)
        if dir_name:
            os.makedirs(dir_name, exist_ok=True)

        st = PDFReport._styles()
        content = []
        data = report_data or {}
        moves = data.get("moves") or []
        counts = data.get("summary_counts") or {}
        acc_w = data.get("accuracy_white", data.get("accuracy", 0) or 0)
        acc_b = data.get("accuracy_black", data.get("accuracy", 0) or 0)
        try:
            acc_w = round(float(acc_w), 1)
        except Exception:
            acc_w = 0
        try:
            acc_b = round(float(acc_b), 1)
        except Exception:
            acc_b = 0
        grade_w = data.get("grade_white") or data.get("grade", "")
        grade_b = data.get("grade_black") or data.get("grade", "")
        avg_cp = counts.get("average_cp_loss", 0)
        total = counts.get("total_moves", len(moves))
        played = data.get("played_at") or data.get("date") or ""
        result = data.get("result") or ""

        content.append(Spacer(1, 34))
        content.append(Paragraph("&#9822;", st["center"]))
        content.append(Paragraph("AI Chess Coach Report", st["cover_title"]))
        content.append(Paragraph(f"{data.get('opening', 'Unknown Opening')}"
                                 + (f" &nbsp;&middot;&nbsp; {result}" if result else ""), st["cover_sub"]))
        if played:
            content.append(Paragraph(str(played), st["cover_sub"]))
        content.append(Spacer(1, 6))
        content.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#D4AF37")))
        content.append(Spacer(1, 10))

        def _bar(pct):
            pct = max(0, min(100, float(pct or 0)))
            filled = int(round(pct / 5))
            return "&#9608;" * filled + "<font color='#E4D0A0'>" + "&#9608;" * (20 - filled) + "</font>"

        acc_rows = [
            [Paragraph("<b>White</b>", st["cell"]), Paragraph(f"<b>{acc_w}%</b>  {grade_w}", st["cell"]),
             Paragraph(_bar(acc_w), st["cell"])],
            [Paragraph("<b>Black</b>", st["cell"]), Paragraph(f"<b>{acc_b}%</b>  {grade_b}", st["cell"]),
             Paragraph(_bar(acc_b), st["cell"])],
        ]
        acc_table = Table(acc_rows, colWidths=[52 * mm, 38 * mm, 80 * mm])
        acc_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#F5EDD8")),
            ("BACKGROUND", (0, 1), (-1, 1), colors.HexColor("#FCF4DE")),
            ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#C8A96E")),
            ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E0C990")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        content.append(acc_table)
        content.append(Spacer(1, 4))
        content.append(Paragraph(f"Style: <b>{data.get('style', '-')}</b> &nbsp;&middot;&nbsp; "
                                 f"{total} moves &nbsp;&middot;&nbsp; Avg loss {avg_cp} cp", st["small"]))
        if data.get("summary_text"):
            content.append(Spacer(1, 4))
            content.append(Paragraph(str(data["summary_text"]).replace("\n", "<br/>"), st["body"]))

        order = ["brilliant", "best", "best_move", "excellent", "good", "inaccuracy", "mistake", "blunder"]
        dist_cells = []
        for k in ["brilliant", "best", "excellent", "good", "inaccuracy", "mistake", "blunder"]:
            n = 0
            for key in ([k] + (["best_move"] if k == "best" else [])):
                n += int(counts.get(key, 0) or 0)
            dist_cells.append([Paragraph(f"<b>{k.title()}</b><br/>{n}", st["center"])])
        if any(int(counts.get(k, 0) or 0) for k in order):
            content.append(Spacer(1, 6))
            content.append(Paragraph("Move quality mix", st["h2"]))
            dist = Table([dist_cells], colWidths=[(170 / 7) * mm] * 7, repeatRows=1)
            dist.setStyle(TableStyle([
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#C8A96E")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E0C990")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#FFF8EE")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]))
            content.append(dist)

        weaknesses = data.get("weaknesses") or []
        content.append(Paragraph("Weaknesses", st["h1"]))
        if weaknesses:
            for w in weaknesses:
                content.append(Paragraph(f"&bull; &nbsp;{w}", st["body"]))
        else:
            content.append(Paragraph("No major recurring weakness detected. Clean game.", st["body"]))

        content.append(Paragraph("Training Plan", st["h1"]))
        plan = data.get("training_plan") or []
        for item in plan:
            if isinstance(item, str):
                content.append(Paragraph(f"&bull; &nbsp;{item}", st["body"]))
                continue
            topic = item.get("topic", "Training")
            mins = item.get("daily_minutes", "")
            adv = item.get("advice", "")
            ex = item.get("exercise", "")
            block = [Paragraph(f"<b>{topic}</b>" + (f" &nbsp;({mins} min/day)" if mins else ""), st["h3"])]
            if adv:
                block.append(Paragraph(adv, st["body"]))
            if ex:
                block.append(Paragraph(f"<i>{ex}</i>", st["small"]))
            content.append(KeepTogether(block))
            content.append(Spacer(1, 4))

        recs = data.get("opening_recommendations") or []
        if recs:
            content.append(Paragraph("Opening Recommendations", st["h2"]))
            for o in recs:
                content.append(Paragraph(f"&bull; &nbsp;{o if isinstance(o, str) else o.get('opening', str(o))}", st["body"]))

        content.append(PageBreak())
        content.append(Paragraph("Move Analysis", st["h1"]))
        content.append(Paragraph("Color-coded by quality. CP loss vs engine best.", st["small"]))
        content.append(Spacer(1, 6))

        label_colors = {
            "brilliant": colors.HexColor("#1a7a5e"), "best": colors.HexColor("#1F5C2E"),
            "best_move": colors.HexColor("#1F5C2E"), "excellent": colors.HexColor("#2d8a4e"),
            "good": colors.HexColor("#A67C52"), "inaccuracy": colors.HexColor("#c9930a"),
            "mistake": colors.HexColor("#c06e1a"), "blunder": colors.HexColor("#8B2500"),
        }
        rows = [[Paragraph("<b>#</b>", st["cell_bold"]), Paragraph("<b>Move</b>", st["cell_bold"]),
                 Paragraph("<b>Quality</b>", st["cell_bold"]), Paragraph("<b>CP loss</b>", st["cell_bold"]),
                 Paragraph("<b>Acc</b>", st["cell_bold"])]]
        for m in moves:
            num = m.get("move_number", m.get("fullmove_number", ""))
            san = m.get("move", m.get("san", ""))
            cls = str(m.get("classification", "good")).lower()
            cp = m.get("cp_loss", 0)
            try:
                cp_txt = f"{float(cp):.0f}"
            except Exception:
                cp_txt = "0"
            acc = m.get("accuracy_score", "")
            try:
                acc_txt = f"{float(acc):.0f}" if acc != "" else "-"
            except Exception:
                acc_txt = "-"
            dot = f"<font color='{label_colors.get(cls, colors.black).hexval()}'>&#9679;</font>"
            rows.append([
                Paragraph(str(num), st["cell"]),
                Paragraph(f"<b>{san}</b>", st["cell"]),
                Paragraph(f"{dot} {cls.replace('_', ' ').title()}", st["cell"]),
                Paragraph(cp_txt, st["cell"]),
                Paragraph(acc_txt, st["cell"]),
            ])
        if len(rows) == 1:
            content.append(Paragraph("No moves found.", st["body"]))
        else:
            t = Table(rows, colWidths=[14 * mm, 34 * mm, 52 * mm, 24 * mm, 20 * mm], repeatRows=1)
            style_cmds = [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1C1008")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#F5EDD8")),
                ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#C8A96E")),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E0C990")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#FBF3DF")]),
            ]
            t.setStyle(TableStyle(style_cmds))
            content.append(t)

        doc = SimpleDocTemplate(output_path, pagesize=A4,
                                leftMargin=18 * mm, rightMargin=18 * mm,
                                topMargin=26 * mm, bottomMargin=16 * mm,
                                title="RightMove Coach Report", author="RightMove")
        doc.build(content, onFirstPage=PDFReport._cover_band, onLaterPages=PDFReport._chrome)
        return output_path


# Classifies centipawn loss with narrative message
def _classify_with_message(cp_loss):
    category = classify_loss(cp_loss)
    if category == "best":
        category = "best_move"
    messages = {
        "best_move": "You found the strongest move in the position.",
        "brilliant": "A brilliant strike — best move with real sacrifice or vision.",
        "excellent": "A very strong move with minimal loss.",
        "good": "A solid move, although stronger options existed.",
        "inaccuracy": "A reasonable move, but it slightly worsened your position.",
        "mistake": "This move significantly reduced your advantage or worsened your position.",
        "blunder": "A serious mistake that likely changed the course of the game.",
    }
    return {"category": category, "message": messages.get(category, "Move played.")}


# Analyzes full PGN games with eval and concepts
class GameAnalyzer:

    # Analyzes full game from PGN path
    @staticmethod
    async def analyze_game(stockfish, pgn_path):
        results = []

        with open(pgn_path, encoding="utf-8") as pgn_file:
            game = chess.pgn.read_game(pgn_file)

        if game is None:
            raise ValueError("Invalid PGN file.")

        board = game.board()
        ply = 1

        for move in game.mainline_moves():
            fen_before = board.fen()
            move_uci = move.uci()
            move_san = board.san(move)
            turn_name = "White" if board.turn == chess.WHITE else "Black"
            fullmove_number = (ply + 1) // 2
            move_label = f"{fullmove_number}." if board.turn == chess.WHITE else f"{fullmove_number}..."

            best_move_uci = None
            best_move_san = ""
            try:
                best_move_uci = await stockfish.best_move(fen_before, depth=10)
                if best_move_uci:
                    best_move_obj = chess.Move.from_uci(best_move_uci)
                    if best_move_obj in board.legal_moves:
                        best_move_san = board.san(best_move_obj)
                    else:
                        best_move_san = best_move_uci
            except Exception:
                best_move_uci = move_uci
                best_move_san = move_san

            if not best_move_uci:
                best_move_uci = move_uci
                best_move_san = move_san

            try:
                before_white = await stockfish.evaluate(fen_before, depth=10)
                temp_board = board.copy()
                temp_board.push(move)
                after_white = await stockfish.evaluate(temp_board.fen(), depth=10)

                if board.turn == chess.WHITE:
                    cp_diff = (before_white - after_white) * 100.0
                    before_pov_cp = before_white * 100.0
                    after_pov_cp = after_white * 100.0
                else:
                    cp_diff = (after_white - before_white) * 100.0
                    before_pov_cp = -before_white * 100.0
                    after_pov_cp = -after_white * 100.0

                cp_loss = max(0.0, round(cp_diff, 2))
                accuracy_score = accuracy_from_wp_diff(
                    round(eval_to_win_prob(before_pov_cp) * 100.0, 1),
                    round(eval_to_win_prob(after_pov_cp) * 100.0, 1),
                )
                eval_result = {
                    "before": round(before_white, 2), "after": round(after_white, 2),
                    "cp_loss": cp_loss, "accuracy_score": accuracy_score,
                    "win_probability_before": round(eval_to_win_prob(before_pov_cp) * 100.0, 1),
                    "win_probability_after": round(eval_to_win_prob(after_pov_cp) * 100.0, 1),
                }
            except Exception:
                cp_loss = 0.0
                eval_result = {"before": 0.0, "after": 0.0, "cp_loss": 0.0, "accuracy_score": 100.0,
                               "win_probability_before": 50.0, "win_probability_after": 50.0}

            classification = _classify_with_message(cp_loss)
            if move_uci == best_move_uci:
                classification = {"category": "best_move", "message": "You found the strongest move in the position."}

            from intelligence import get_concepts
            concept_data = get_concepts(move=move_uci, board=board, move_obj=move, best_move_uci=best_move_uci)

            board.push(move)
            fen_after = board.fen()

            results.append({
                "ply": ply, "fullmove_number": fullmove_number, "move_number": fullmove_number,
                "move_label": move_label, "turn": turn_name, "san": move_san, "move": move_uci,
                "best_move": best_move_uci, "best_move_san": best_move_san,
                "is_best": (move_uci == best_move_uci),
                "eval_before": eval_result.get("before", 0.0), "eval_after": eval_result.get("after", 0.0),
                "cp_loss": cp_loss, "accuracy_score": eval_result.get("accuracy_score", 100.0),
                "win_probability_before": eval_result.get("win_probability_before", 50.0),
                "win_probability_after": eval_result.get("win_probability_after", 50.0),
                "classification": classification["category"],
                "classification_msg": classification.get("message", ""),
                "concepts": concept_data.get("concepts", []),
                "explanation": concept_data.get("explanation", ""),
                "fen_before": fen_before, "fen_after": fen_after,
            })

            ply += 1

        return results
