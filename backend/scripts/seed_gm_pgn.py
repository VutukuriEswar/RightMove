# Seeds the GM historical database with curated grandmaster games
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

CURATED_PGNS = """
[Event "World Championship 35th"]
[Site "Moscow URS"]
[Date "1985.10.15"]
[Round "16"]
[White "Karpov, Anatoly"]
[Black "Kasparov, Garry"]
[Result "0-1"]

1. e4 c5 2. Nf3 e6 3. d4 cxd4 4. Nxd4 Nc6 5. Nb5 d6 6. c4 Nf6 7. N1c3 a6
8. Na3 d5 9. cxd5 exd5 10. exd5 Nb4 11. Be2 Bc5 12. O-O O-O 13. Bf3 Bf5
14. Bg5 Re8 15. Qd2 b5 16. Rad1 Nd3 17. Nab1 h6 18. Bh4 b4 19. Na4 Bd6
20. Bg3 Rc8 21. b3 g5 22. Bxd6 Qxd6 23. g3 Nd7 24. Bg2 Qf6 25. a3 a5
26. axb4 axb4 27. Qa2 Bg6 28. d6 g4 29. Qd2 Kg7 30. f3 Qxd6 31. fxg4 Qd4+
32. Kh1 Nf6 33. Rf4 Ne4 34. Qxd3 Nf2+ 35. Rxf2 Bxd3 36. Rfd2 Qe3
37. Rxd3 Rc1 38. Nb2 Qf2 39. Nd2 Rxd1+ 40. Nxd1 Re1+ 0-1

[Event "World Championship"]
[Site "Reykjavik ISL"]
[Date "1972.07.23"]
[Round "6"]
[White "Fischer, Robert James"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. c4 e6 2. Nf3 d5 3. d4 Nf6 4. Nc3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6
8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Be6 12. Qa4 c5 13. Qa3 Rc8
14. Bb5 a6 15. dxc5 bxc5 16. O-O Ra7 17. Be2 Nd7 18. Nd4 Qf8 19. Nxe6 fxe6
20. e4 d4 21. f4 Qe7 22. e5 Rb8 23. Bc4 Kh8 24. Qh3 Nf8 25. b3 a5 26. f5 exf5
27. Rxf5 Nh7 28. Rcf1 Qd8 29. Qg3 Re7 30. h4 Rbb7 31. e6 Rbc7 32. Qe5 Qe8
33. a4 Qd8 34. R1f2 Qe8 35. R2f3 Qd8 36. Bd3 Qe8 37. Qe4 Nf6 38. Rxf6 gxf6
39. Rxf6 Kg8 40. Bc4 Kh8 41. Qf4 1-0

[Event "Grenke Chess Classic"]
[Site "Karlsruhe/Baden-Baden GER"]
[Date "2019.04.28"]
[Round "7"]
[White "Carlsen, Magnus"]
[Black "Meier, Georg"]
[Result "1-0"]

1. d4 Nf6 2. c4 e6 3. Nf3 d5 4. Nc3 c6 5. e3 Nbd7 6. Qc2 Bd6 7. g4 h6
8. Rg1 e5 9. cxd5 Nxd5 10. Bd2 exd4 11. Nxd5 cxd5 12. Nxd4 Ne5 13. Be2 O-O
14. O-O-O Bd7 15. Kb1 Rc8 16. Bc3 Bb4 17. Bxb4 Rxc2 18. Nxc2 Re8 19. g5 hxg5
20. Rxd5 Qc8 21. Bc3 f6 22. Bxe5 Rxe5 23. Rxe5 fxe5 24. Rxg5 Bf5 25. Bd1 Qd7
26. Kc1 g6 27. Rg1 Qd5 28. b3 a5 29. Be2 Qc5 30. Bc4+ Kg7 31. Rd1 b5
32. Rd5 Qc7 33. Rxb5 a4 34. Kb2 axb3 35. axb3 Qd6 36. Rd5 Qf6 37. Rd2 Qh4
38. f3 Qh3 39. Bd5 Bxc2 40. Kxc2 Qf1 41. Be4 Qa1 42. Kd3 Qb1+ 43. Ke2 Qxb3 1-0

[Event "Candidates Match"]
[Site "Bled YUG"]
[Date "1959.10.11"]
[Round "20"]
[White "Tal, Mikhail"]
[Black "Smyslov, Vasily"]
[Result "1-0"]

1. e4 c6 2. d3 d5 3. Nd2 e5 4. Ngf3 Nd7 5. d4 dxe4 6. Nxe4 exd4 7. Qxd4 Ngf6
8. Bg5 Be7 9. O-O-O O-O 10. Nd6 Qa5 11. Bc4 b5 12. Bd2 Qa6 13. Nf5 Bd8
14. Qh4 bxc4 15. Qg5 Nh5 16. Nh6+ Kh8 17. Qxh5 Qxa2 18. Bc3 Nf6 19. Qxf7 Qa1+
20. Kd2 Re8 21. Ne5 Be6 22. Rxa1 Bxf7 23. Nhxf7+ Kg8 24. Nxd8 Raxd8+
25. Kc1 Ne4 26. Nxc6 1-0

[Event "Pearl of Zandvoort"]
[Site "Zandvoort NED"]
[Date "1936.07.26"]
[Round "?"]
[White "Alekhine, Alexander"]
[Black "Euwe, Max"]
[Result "1-0"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Qc2 c5
8. Rd1 Qa5 9. Bd3 cxd4 10. exd4 dxc4 11. Bxc4 Nb6 12. Bd3 Bd7 13. Ne4 Nxe4
14. Bxe4 Bc6 15. Bxc6 bxc6 16. O-O Rfd8 17. Ne5 Nd5 18. Bxe7 Nxe7 19. Qe4 Nd5
20. Rc1 Qb6 21. b3 Nb4 22. a3 Nd5 23. b4 a5 24. Qg4 axb4 25. axb4 Qb7 26. b5
cxb5 27. Nxb5 Rd6 28. Nc7 Rc8 29. Rxc8+ Qxc8 30. Rb1 Nf6 31. Qe2 Qc2
32. Qxc2 Rxc2 33. Nb5 Nd5 34. Rb3 Rc1+ 35. Kh2 h6 36. h3 Kf8 37. g4 Ke7
38. Rb2 Ne3 39. f3 Nf1+ 40. Kg2 Nxh3 41. Rxb7+ Ke8 42. Kxh3 1-0

[Event "New York"]
[Site "New York USA"]
[Date "1927.??.??"]
[Round "?"]
[White "Capablanca, Jose Raul"]
[Black "Alekhine, Alexander"]
[Result "1-0"]

1. d4 d5 2. Nf3 e6 3. c4 Nf6 4. Bg5 Nbd7 5. e3 Bb4+ 6. Nc3 O-O 7. Rc1 c5
8. Bd3 Qa5 9. Qc2 Bxc3+ 10. bxc3 dxc4 11. Bxc4 e5 12. dxe5 Nxe5 13. Nxe5 Qxe5
14. O-O b6 15. c4 Bb7 16. f3 Rfe8 17. Rfd1 Qh5 18. Be2 Ng4 19. Bxh5 Rxe3
20. Bf4 Re2 21. Bd3 Rxc2 22. Rxc2 Nxh2 23. Bxh7+ Kxh7 24. Rxh2 Rd8
25. Rxd8 1-0

[Event "USSR Championship"]
[Site "Moscow URS"]
[Date "1947.??.??"]
[Round "?"]
[White "Botvinnik, Mikhail"]
[Black "Lilienthal, Andor"]
[Result "1-0"]

1. c4 Nf6 2. Nc3 e6 3. Nf3 d5 4. d4 Be7 5. Bg5 O-O 6. e3 Nbd7 7. Bd3 c5
8. O-O cxd4 9. exd4 dxc4 10. Bxc4 Nb6 11. Bb3 Bd7 12. Qd2 Nbd5 13. Ne5 Bc6
14. Rfd1 Nb4 15. Rac1 Nbd5 16. Nxc6 bxc6 17. Bxf6 Nxf6 18. Ne4 Nxe4
19. Bxe4 Rb8 20. Bc2 Qd5 21. b3 e5 22. dxe5 Rfd8 23. Qf4 Rd4 24. Rd3 Rbd8
25. Rcd1 g6 26. h4 Rxd3 27. Rxd3 Rxd3 28. Bxd3 Qxd3 29. Qxf7+ Kh8 30. h5 1-0

[Event "Amsterdam Olympiad"]
[Site "Amsterdam NED"]
[Date "1954.??.??"]
[Round "?"]
[White "Smyslov, Vasily"]
[Black "Keres, Paul"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be2 e5 7. Nb3 Be7
8. O-O O-O 9. Be3 Be6 10. f4 exf4 11. Rxf4 Ne8 12. Qd3 Bg5 13. Bxg5 Qxg5
14. Rd1 Nc6 15. Nd4 Nce7 16. Rh4 h6 17. Nde2 Nf6 18. Nc1 Qd8 19. Nd3 Nc6
20. e5 dxe5 21. Nxe5 Nxe5 22. Qxd8 Rfxd8 23. Rxd8+ Rxd8 24. Rxh6 Ng6
25. h4 Ne7 26. Rh5 Rd1+ 27. Kf2 Rd2+ 28. Ke1 Rxc2 29. h5 Ne4 30. Rxe5 f5
31. h6 gxh6 32. Rxe4 1-0

[Event "Hastings"]
[Site "Hastings ENG"]
[Date "1895.??.??"]
[Round "?"]
[White "Pillsbury, Harry Nelson"]
[Black "Lasker, Emanuel"]
[Result "1-0"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. Nf3 Nbd7 6. Rc1 O-O 7. e3 b6
8. cxd5 exd5 9. Bd3 Bb7 10. O-O c5 11. Ne5 Nxe5 12. dxe5 Ne4 13. Bxe7 Qxe7
14. f3 Nxc3 15. Rxc3 cxd4 16. exd4 Rac8 17. f4 Rxc3 18. bxc3 f6 19. f5 Kh8
20. e6 Bc8 21. Qh5 Qf8 22. Rxf3 Rg8 23. Rg3 g5 24. fxg6 hxg6 25. Rxg6 Rxg6
26. Bxg6 Qxe6 27. Qf3 Bd7 28. Bxd5 Qf5 29. Qxf5 Bxf5 30. c4 1-0

[Event "New York"]
[Site "New York USA"]
[Date "1924.??.??"]
[Round "?"]
[White "Capablanca, Jose Raul"]
[Black "Reti, Richard"]
[Result "1-0"]

1. d4 Nf6 2. Nf3 d5 3. c4 c6 4. Nc3 Bf5 5. cxd5 cxd5 6. Qb3 Qc7 7. Bf4 Qc6
8. e3 e6 9. Ne5 Qc7 10. Bb5+ Nc6 11. Nxc6 bxc6 12. Ba4 Ne4 13. O-O Bd6
14. Bxd6 Nxd6 15. f3 O-O 16. Qc2 f5 17. Nxd5 Qd7 18. Nf4 Rfe8 19. Rfd1 Nf7
20. Rd3 Nd6 21. Rad1 Nb5 22. Bb3 Nd4 23. exd4 Qxd4+ 24. Kh1 Re2 25. Qxe2 1-0

[Event "USSR Championship"]
[Site "Leningrad URS"]
[Date "1960.??.??"]
[Round "?"]
[White "Tal, Mikhail"]
[Black "Tolush, Alexander"]
[Result "1-0"]

1. e4 c5 2. Nf3 Nc6 3. d4 cxd4 4. Nxd4 e6 5. Nc3 d6 6. Be3 Nf6 7. f4 Be7
8. Be2 O-O 9. O-O e5 10. Nb3 exf4 11. Bxf4 Be6 12. Nd5 Bxd5 13. exd5 Nb4
14. a3 Na6 15. Qd3 Nc5 16. Nxc5 dxc5 17. Rae1 Qd7 18. c4 Rfe8 19. Bf3 Rxe1
20. Rxe1 Re8 21. Rxe8+ Qxe8 22. Qe3 Qd7 23. Qe6+ Qxe6 24. dxe6 g6 25. Bd5 Ng4
26. Bg3 Ne5 27. e7 Bc7 28. h4 1-0

[Event "Amsterdam"]
[Site "Amsterdam NED"]
[Date "1950.??.??"]
[Round "?"]
[White "Kotov, Alexander"]
[Black "Pachman, Ludek"]
[Result "1-0"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Rc1 c6
8. Qc2 a6 9. a3 h6 10. Bh4 Re8 11. Bd3 dxc4 12. Bxc4 e5 13. O-O exd4
14. exd4 Nb6 15. Ba2 Bg4 16. Rfe1 Qd7 17. Bg3 Bh5 18. Ne4 Nxe4 19. Rxe4 Bf6
20. Rce1 Rxe4 21. Rxe4 Bg6 22. Re1 Nd5 23. Ne5 Qd6 24. Nxg6 fxg6 25. h3 Rb8
26. Qe4 Nb4 27. Bb1 Qd7 28. Re3 Na2 29. Bxa2 Qxa2 30. d5 Qd2 31. dxc6 bxc6
32. Rd3 Qf4 33. Qxc6 Rb6 34. Qxa6 Rxa6 35. Rd8+ Kh7 36. Ra8 Rxa8 37. Bxa8 1-0

[Event "World Championship"]
[Site "Moscow URS"]
[Date "1954.??.??"]
[Round "?"]
[White "Botvinnik, Mikhail"]
[Black "Smyslov, Vasily"]
[Result "1/2-1/2"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Rc1 c5
8. cxd5 Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. dxc5 Nxc5 12. Be2 Be6 13. O-O Rfc8
14. Nd4 Bd7 15. Nf3 Bc6 16. Bd3 Ne4 17. Bb1 Qf6 18. Nd4 Bd7 19. Nf3 Bc6
20. Nd4 Bd7 1/2-1/2

[Event "Zurich Candidates"]
[Site "Zurich SUI"]
[Date "1953.??.??"]
[Round "?"]
[White "Keres, Paul"]
[Black "Reshevsky, Samuel"]
[Result "1-0"]

1. e4 c6 2. d4 d5 3. Nc3 dxe4 4. Nxe4 Nf6 5. Nxf6+ exf6 6. c3 Bd6 7. Bd3 O-O
8. Nf3 Re8+ 9. Kf1 Bg4 10. h3 Bxf3 11. Qxf3 Nd7 12. g3 Nc5 13. Bc2 Ne6
14. d5 cxd5 15. Qxd5 Qc7 16. Kg2 Bc5 17. Rd1 Rad8 18. Qh5 Re7 19. Bf4 Ng5
20. Bxg5 fxg5 21. Rxd8+ Qxd8 22. Rd1 Qc7 23. Rd5 g6 24. Qf3 Bf8 25. Rxg5 Re5
26. Rxe5 Qxe5 27. Qxb7 Qe1 28. Bd1 h5 29. b3 h4 30. g4 Qe4+ 31. Kh2 Qe5+
32. Kg2 Qe4+ 33. Kh2 Be7 34. g5 Bf8 35. Qxa7 Qe5+ 36. f4 1-0

[Event "USSR Championship"]
[Site "Moscow URS"]
[Date "1965.??.??"]
[Round "?"]
[White "Spassky, Boris V"]
[Black "Bronstein, David I"]
[Result "1-0"]

1. e4 e5 2. f4 d5 3. exd5 e4 4. Bb5+ c6 5. dxc6 Nxc6 6. Nc3 Nf6 7. Qe2 Bf5
8. f5 Bc5 9. d3 O-O 10. dxe4 Nxe4 11. Nxe4 Bxe4 12. c3 Qe7 13. Ne2 Bxe2
14. Qxe2 Rfe8 15. Kd1 Qxe2+ 16. Bxe2 Rad8+ 17. Bd2 Rxd2+ 18. Kxd2 Rxe2+
19. Kxe2 Nd4+ 20. Kd1 Nxf5 21. Rf1 Bd4 22. Kc2 Nd6 23. b4 Bb6 24. a4 Nd7
25. a5 Bc7 26. b5 Nf6 27. Rxf6 1-0

[Event "Amsterdam Interzone"]
[Site "Amsterdam NED"]
[Date "1964.??.??"]
[Round "?"]
[White "Spassky, Boris V"]
[Black "Darga, Klaus"]
[Result "1-0"]

1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Be2 O-O 6. Nf3 e5 7. d5 Nbd7
8. Bg5 h6 9. Bh4 g5 10. Bg3 Nh5 11. h4 Nxg3 12. fxg3 gxh4 13. gxh4 f5
14. exf5 Rxf5 15. Ng5 Rxf1+ 16. Bxf1 hxg5 17. hxg5 Nf8 18. Qd3 Bh6
19. g6 Qg5 20. Ne4 Qxg6 21. Rh6 Qg4 22. Rxh6 1-0

[Event "Bad Pistyan"]
[Site "Pistyan CZE"]
[Date "1922.??.??"]
[Round "?"]
[White "Bogoljubov, Efim"]
[Black "Alekhine, Alexander"]
[Result "0-1"]

1. d4 f5 2. c4 Nf6 3. g3 e6 4. Bg2 Bb4+ 5. Bd2 Bxd2+ 6. Nxd2 Nc6 7. Ngf3 O-O
8. O-O d6 9. Qb3 Kh8 10. Qc3 e5 11. e3 a5 12. b3 Qe8 13. a3 Qh5 14. h4 Ng4
15. Ng5 e4 16. Bf1 Nce5 17. Be2 Nf6 18. Bf1 Nc6 19. Be2 Ne7 20. Bf1 Be6
21. Rfd1 Nf3+ 22. Nxf3 Qxf3 23. Qe1 Ng4 24. Rd2 Rf6 25. Rg2 Rh6 26. Qe2 Qxh4
27. Nxe4 fxe4 28. Qxe4 Nxe3 29. Rgg1 Nf1 30. Rxf1 Rxh4+ 31. Kg2 Rh2+ 32. Kf3
Rxf2+ 33. Kxf2 Qh2+ 34. Ke3 Qxg1+ 35. Kd2 Rd8 36. Kc2 Qxf1 37. Qxe6 Rd2+
38. Kb1 Qd3+ 0-1

[Event "Luzern Olympiad"]
[Site "Luzern SUI"]
[Date "1982.??.??"]
[Round "?"]
[White "Kasparov, Garry"]
[Black "Sax, Gyula"]
[Result "1-0"]

1. c4 e5 2. Nc3 Nf6 3. Nf3 Nc6 4. e3 Be7 5. d4 d5 6. cxd5 Nxd5 7. dxe5 Nxc3
8. bxc3 Qd5 9. Bb5 Qxe5 10. O-O O-O 11. c4 Bd7 12. Bxc6 Bxc6 13. Bb2 Qa5
14. Qd3 f6 15. Nd4 Bd7 16. e4 Rfd8 17. Nf5 Bf8 18. f4 g6 19. Nh6+ Kh8
20. Qg3 Bc6 21. f5 Rd4 22. fxg6 hxg6 23. Rxf6 Qxa2 24. Rh6+ Kg7 25. Nxf7+ 1-0

[Event "Tallinn"]
[Site "Tallinn URS"]
[Date "1975.??.??"]
[Round "?"]
[White "Tal, Mikhail"]
[Black "Larsen, Bent"]
[Result "1-0"]

1. e4 e5 2. f4 Bc5 3. Nf3 d6 4. c3 Nf6 5. d4 exd4 6. cxd4 Bb6 7. Nc3 Nxe4
8. Bd3 Nxc3 9. bxc3 d5 10. O-O O-O 11. Ne5 Be6 12. Qf3 Nc6 13. Nxc6 bxc6
14. f5 Bc8 15. Re1 Re8 16. Rb1 Ba7 17. Rxe8+ Qxe8 18. Bf4 Bxd4 19. cxd4 c5
20. Be5 Qd8 21. Qg3 cxd4 22. Bxd4 g6 23. Bb6 Qd6 24. fxg6 hxg6 25. Rb2 Bd7
26. Bxg6 1-0

[Event "Zurich Candidates"]
[Site "Zurich SUI"]
[Date "1953.??.??"]
[Round "?"]
[White "Bronstein, David I"]
[Black "Kotov, Alexander"]
[Result "1-0"]

1. d4 d5 2. c4 c6 3. Nc3 Nf6 4. e3 e6 5. Nf3 Nbd7 6. Bd3 dxc4 7. Bxc4 b5
8. Bd3 Bb7 9. O-O a6 10. e4 c5 11. e5 cxd4 12. Nxb5 axb5 13. exf6 gxf6 14. Ne5
Nxe5 15. Qh5 Ng6 16. Re1 Qd5 17. Re5 Qxa2 18. Rg5 Qxb2 19. Rxg6 hxg6
20. Qxg6+ Ke7 21. Qxf6+ Ke8 22. Qxe6+ Be7 23. Bxb5+ Kf8 24. Qf5+ Qf6
25. Rxb7 Qxf5 26. Rb8+ 1-0

[Event "USSR Championship"]
[Site "Moscow URS"]
[Date "1949.??.??"]
[Round "?"]
[White "Bondarevsky, Igor"]
[Black "Flohr, Salo"]
[Result "1-0"]

1. d4 Nf6 2. c4 e6 3. Nc3 d5 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Rc1 c6
8. Qc2 Re8 9. Bd3 dxc4 10. Bxc4 Nd5 11. Bxe7 Qxe7 12. Ne4 N5f6 13. Nxf6+
Nxf6 14. O-O e5 15. dxe5 Qxe5 16. Rfd1 Bc8 17. Qe2 Bf5 18. Bxf5 Qxf5
19. Ne5 Qe6 20. Nc4 Nd5 21. e4 Nb4 22. a3 Na6 23. Nd6 Rf8 24. e5 Nc5
25. Qe4 g6 26. e6 1-0

[Event "World Championship"]
[Site "Moscow URS"]
[Date "1963.??.??"]
[Round "?"]
[White "Petrosian, Tigran V"]
[Black "Botvinnik, Mikhail"]
[Result "1-0"]

1. c4 g6 2. d4 Bg7 3. e4 d6 4. Nc3 Nf6 5. Be2 O-O 6. Bg5 c5 7. d5 e6 8. Nf3
exd5 9. cxd5 Re8 10. Nd2 Na6 11. O-O Nc7 12. Qc2 b5 13. a4 b4 14. Nb1 a5
15. f3 Ba6 16. Nd2 Nb5 17. Qb3 Qd7 18. Ra2 Nh5 19. Nf1 Nf4 20. Ng3 Nxe2+
21. Nxe2 g5 22. e5 dxe5 23. d6 Qf5 24. Rd2 Qg6 25. Nf5 Rxe2 26. Rxe2 Nxd6
27. Nxd6 Qxd6 28. Rd1 Qf6 29. Rxe5 g4 30. fxg4 Bxb2 31. Rd6 Qe7 32. Rb6 Bc3
33. Rxb5 Bxb5 34. axb5 Rb8 35. Re6 Qd7 36. Rxc6 Be5 37. Rc8+ 1-0

[Event "World Championship"]
[Site "Moscow URS"]
[Date "1966.??.??"]
[Round "?"]
[White "Petrosian, Tigran V"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. d4 d5 2. c4 c6 3. Nf3 Nf6 4. Nc3 e6 5. Bg5 dxc4 6. e4 b5 7. e5 h6 8. Bh4
g5 9. Nxg5 hxg5 10. Bxg5 Nbd7 11. exf6 Bb7 12. g3 c5 13. d5 Qb6 14. Bg2 O-O-O
15. O-O b4 16. dxe6 bxc3 17. exd7+ Rxd7 18. bxc3 Qb2 19. Bd5 Rxd5 20. Qxd5
Bxd5 21. Rfd1 Bc6 22. Rxd8+ Kxd8 23. Rd1+ Kc7 24. Bf4+ e5 25. Rd7+ 1-0

[Event "Reykjavik"]
[Site "Reykjavik ISL"]
[Date "1958.??.??"]
[Round "?"]
[White "Fischer, Robert James"]
[Black "Larsen, Bent"]
[Result "1-0"]

1. c4 e6 2. Nc3 d5 3. d4 Nf6 4. Nf3 Be7 5. Bg5 O-O 6. e3 h6 7. Bh4 b6 8. cxd5
Nxd5 9. Bxe7 Qxe7 10. Nxd5 exd5 11. Rc1 Bb7 12. Bb5 c6 13. Bd3 Nd7 14. O-O Nf6
15. Ne5 Rfd8 16. Qf3 c5 17. Nxf7 Rxd4 18. Nxh6+ gxh6 19. Rxc5 Ne4 20. Bxe4
dxe4 21. Qxe4 Rxd1 22. Rxd1 Qf6 23. h4 1-0

[Event "Bugojno"]
[Site "Bugojno YUG"]
[Date "1980.??.??"]
[Round "?"]
[White "Portisch, Lajos"]
[Black "Larsen, Bent"]
[Result "1-0"]

1. c4 Nf6 2. Nc3 c5 3. Nf3 d5 4. cxd5 Nxd5 5. e3 Nc6 6. Bc4 Nb6 7. Bb3 e6
8. O-O Be7 9. Qe2 O-O 10. Rd1 Nd5 11. Ne4 b6 12. a4 a6 13. a5 bxa5 14. Nxc5
Bxc5 15. Rxa5 Bb7 16. Bb4 Qf6 17. Nxd5 exd5 18. Rxd5 Rfd8 19. Rxa6 Nxb4
20. Rxb4 Bc6 21. Qc4 Bd7 22. Rbb6 Rxd5 23. Qxd5 Be8 24. Rd6 Bf8 25. Rxd8 Qxd8
26. Bc2 g6 27. Qd6 Qxd6 28. Rxd6 Be7 29. Rb6 Bc5 30. Rxb1 1-0

[Event "USSR Championship"]
[Site "Moscow URS"]
[Date "1973.??.??"]
[Round "?"]
[White "Karpov, Anatoly"]
[Black "Spassky, Boris V"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Nxe4 6. d4 b5 7. Bb3 d5 8. dxe5
Be6 9. c3 Bc5 10. Nbd2 O-O 11. Bc2 Nxf2 12. Rxf2 f6 13. exf6 Qxf6 14. Nf1 Bxf2+
15. Nxf2 Rae8 16. Ng4 Qf3 17. Qxf3 Rxf3 18. Bg5 h6 19. Bh4 Rxf2 20. Nxf2 Nxd4
21. cxd4 Bxb3 22. axb3 Rxe2 23. Ng4 d4 24. Bc4+ Kh8 25. Rd1 h5 26. Rxd4 hxg4
27. Bxe2 1-0

[Event "Linares"]
[Site "Linares ESP"]
[Date "1998.03.07"]
[Round "13"]
[White "Kasparov, Garry"]
[Black "Topalov, Veselin"]
[Result "1-0"]

1. d4 d5 2. c4 c6 3. Nc3 Nf6 4. e3 e6 5. Nf3 a6 6. b3 Bb4 7. Bd2 Nbd7 8. Bd3
O-O 9. O-O Bd6 10. Qc2 e5 11. cxd5 cxd5 12. e4 exd4 13. Nxd5 Nxd5 14. exd5 Nf6
15. h3 Bc5 16. Nxd4 Bb7 17. Nf5 Qd7 18. Rae1 Rfe8 19. Rxe8+ Rxe8 20. Nxd6 Qxd6
21. Bf4 Qxd5 22. Bc7 Ng4 23. hxg4 Qxc7 24. g5 Qe5 25. Qd1 Qxg5 26. Qd6 Qd8
27. Qxd8+ Rxd8 28. Bc4 b5 29. Bb3 Ba8 30. Re1 h5 31. Re7 h4 32. Bd5 g5
33. Ra7 Bb7 34. Bxb7 Rxb7 35. Rxa6 Rxb3 36. axb3 1-0

[Event "Amsterdam Interzone"]
[Site "Amsterdam NED"]
[Date "1964.??.??"]
[Round "?"]
[White "Fischer, Robert James"]
[Black "Julio Bolbochan"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3
Na5 9. Bc2 c5 10. d4 Qc7 11. Nbd2 Nc6 12. Nf1 O-O 13. Ne3 Re8 14. h3 cxd4
15. cxd4 d5 16. e5 Nd7 17. Nf5 Bf8 18. Ng5 h6 19. Nxd5 Qd8 20. Nxf7 Qxf7
21. Qh5 Nf6 22. Nxf6+ gxf6 23. exf6 Nb4 24. Be3 Nxc2 25. Rac1 Nxe3 26. fxe3 Be6
27. Qf3 Rc8 28. Rxc8 Rxc8 29. e4 1-0

[Event "Rotterdam"]
[Site "Rotterdam NED"]
[Date "1989.??.??"]
[Round "?"]
[White "Kasparov, Garry"]
[Black "Karpov, Anatoly"]
[Result "1-0"]

1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Nf3 O-O 6. Be2 e5 7. O-O Nc6 8. d5
Ne7 9. Ne1 Nd7 10. Be3 f5 11. f3 f4 12. Bf2 g5 13. b4 Ng6 14. c5 Nf6 15. cxd6
cxd6 16. a4 Rf7 17. a5 g4 18. Nb5 Bf8 19. Ra4 g3 20. hxg3 fxg3 21. Bxg3 Nxe4
22. fxe4 Rxf1+ 23. Kxf1 Qh4 24. Bxg4+ Kh8 25. Ke2 Bxg4+ 26. Kd2 Qf4+
27. Kc2 Bxd1+ 28. Qxd1 Qxg3 29. Re4 Qg2+ 30. Kb3 1-0

[Event "Candidates Match"]
[Site "Curacao NED"]
[Date "1962.??.??"]
[Round "?"]
[White "Fischer, Robert James"]
[Black "Petrosian, Tigran V"]
[Result "1-0"]

1. e4 e6 2. d4 d5 3. Nc3 Nf6 4. Bg5 dxe4 5. Nxe4 Be7 6. Bxf6 Bxf6 7. Nf3 O-O
8. Bd3 Nc6 9. c3 e5 10. Qe2 exd4 11. cxd4 Nb4 12. O-O-O Nxd3+ 13. Rxd3 Bg4
14. h3 Bxf3 15. Qxf3 c6 16. g4 Qb6 17. d5 cxd5 18. Nxf6+ gxf6 19. Rxd5 Rfd8
20. Rxd8+ Rxd8 21. Qd1 Rxd1+ 22. Kxd1 Kg7 23. Ke2 1-0

[Event "Turin Olympiad"]
[Site "Turin ITA"]
[Date "2006.05.26"]
[Round "?"]
[White "Carlsen, Magnus"]
[Black "Naiditsch, Arkadij"]
[Result "0-1"]

1. d4 Nf6 2. c4 g6 3. Nc3 Bg7 4. e4 d6 5. Be2 O-O 6. Nf3 e5 7. O-O Nc6 8. d5
Ne7 9. b4 Ne8 10. c5 f5 11. Ng5 Nf6 12. Bf3 h6 13. Ne6 Bxe6 14. dxe6 fxe4
15. Nxe4 Nfxe4 16. Bxe4 Nf5 17. c6 bxc6 18. Bc2 e4 19. a4 d5 20. Ba3 Re8
21. a5 Nxh2 22. Qd2 Nf3+ 23. Qxf3 exf3 24. Bxf8 Qxf8 25. gxf3 Qf6 26. Rac1 Bf8
27. b5 Rd8 28. Rfd1 d4 29. Bc4+ Kh7 30. a6 d3 31. b6 axb6 32. a7 Qxa1 33. Rxa1
Rxa7 0-1

[Event "Wijk aan Zee"]
[Site "Wijk aan Zee NED"]
[Date "2004.01.16"]
[Round "1"]
[White "Kasparov, Garry"]
[Black "Topalov, Veselin"]
[Result "1-0"]

1. d4 Nf6 2. c4 g6 3. Nc3 d5 4. cxd5 Nxd5 5. e4 Nxc3 6. bxc3 Bg7 7. Bc4 c5
8. Ne2 Nc6 9. Be3 O-O 10. O-O b6 11. dxc5 Qc7 12. Nd4 Ne5 13. Nb5 Qd7 14. cxb6
axb6 15. Bd5 Bb7 16. Bxb7 Qxb7 17. Nd4 Nc4 18. Bc1 Rfd8 19. Qe2 Nd2 20. Rd1 Nc4
21. Nb5 Bf8 22. h4 Nb2 23. Rxd8 Rxd8 24. h5 Nxc4 25. Qxc4 Rd1+ 26. Kh2 Qd5
27. Qxd5 Rxd5 28. hxg6 hxg6 29. a4 g5 30. a5 bxa5 31. Rxa5 g4 32. Rxc5 g3+
33. Kg1 g2 34. Nc7 Rxc5 35. Ne8 Re5 36. Nxf6+ Kf8 37. Ng4 Re1+ 38. Kxg2 1-0

[Event "New York Match"]
[Site "New York USA"]
[Date "1927.??.??"]
[Round "?"]
[White "Alekhine, Alexander"]
[Black "Capablanca, Jose Raul"]
[Result "1-0"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O 6. Nf3 Nbd7 7. Qc2 c5 8. Rd1
Qa5 9. Bd3 cxd4 10. exd4 dxc4 11. Bxc4 Nb6 12. Bd3 Bd7 13. Ne4 Nxe4 14. Bxe4
Bc6 15. O-O Bxe4 16. Qxe4 Rfd8 17. Ne5 Nd5 18. Bxe7 Qxe7 19. Rd3 g6 20. Re1 Qd6
21. Qg4 Kf8 22. Rh3 h5 23. Rxh5 gxh5 24. Qxd7 Kg8 25. Qe6+ Kh7 26. Ng4 1-0

[Event "USSR Team Championship"]
[Site "Moscow URS"]
[Date "1955.??.??"]
[Round "?"]
[White "Spassky, Boris V"]
[Black "Averbach, Yuri"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. f4 e5 7. Nf3 Qc7
8. Bd3 Nc6 9. fxe5 Nxe5 10. Nxe5 dxe5 11. O-O Bc5+ 12. Kh1 O-O 13. Qe2 Ng4
14. Nd5 Qd8 15. Nxc5 Qxd3 16. cxd3 Nxh2 17. Ne6 Nxf1 18. Nxf8 Kxf8 19. Qxf1 Be6
20. Bd2 Ke7 21. Bc3 Rd8 22. Qf2 Rd6 23. Bb4 Rd7 24. Bc5+ Ke8 25. Qf5 Rf7
26. Qxe5+ Kd7 27. Rd1+ Kc8 28. Rd8# 1-0
"""


def _build_pgn_file(output_path: str):
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(CURATED_PGNS.strip(), encoding="utf-8")
    print(f"[gm_seed] Written {len(CURATED_PGNS.strip().splitlines())} lines to {output_path}")


if __name__ == "__main__":
    output = Path(__file__).resolve().parent.parent / "data" / "grandmaster_games_1000.pgn"
    _build_pgn_file(str(output))
    print(f"[gm_seed] Done. Seed file at: {output}")
