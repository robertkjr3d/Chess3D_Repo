#ifndef MATE_IN_2_GENERATOR_H_INCLUDED
#define MATE_IN_2_GENERATOR_H_INCLUDED

#include "quadlevel_board.h"
#include "quadlevel_search.h"
#include <vector>
#include <string>
#include <cstdint>
#include <random>

namespace QuadLevel {

// Structure to hold a verified mate-in-2 puzzle
struct MateInTwoPuzzle {
    std::string fen;           // Position from side-to-move's perspective
    std::string first_move;    // Best first move (algebraic)
    std::string mating_line;   // e.g., "Qxc7 forced, then checkmate"
    Color       side_to_move;  // Who has mate-in-2
};

// Generates, verifies, and caches mate-in-2 puzzles
class MateInTwoGenerator {
public:
    MateInTwoGenerator(size_t cache_limit = 100);
    
    // Generate a new random mate-in-2 puzzle
    // Returns empty puzzle if generation fails after max_attempts
    MateInTwoPuzzle generate_puzzle(int max_attempts = 1000, int time_limit_ms = 5000);
    
    // Verify if a given position is a mate-in-2 for the side to move
    bool is_mate_in_two(const Position3D& pos, int time_limit_ms = 5000);
    
    // Get puzzle by index from cache (0-based)
    const MateInTwoPuzzle* get_cached_puzzle(size_t idx) const;
    
    // Get all cached puzzles
    const std::vector<MateInTwoPuzzle>& get_cache() const { return puzzle_cache; }
    
    // Clear the cache
    void clear_cache() { puzzle_cache.clear(); }
    
    // Get cache size
    size_t cache_size() const { return puzzle_cache.size(); }
    
private:
    std::vector<MateInTwoPuzzle> puzzle_cache;
    size_t max_cache_size;
    std::mt19937 rng;
    Search3D verifier;
    
    // Generate a random position by mutating the starting position
    Position3D generate_random_position(int depth);
    
    // Check if position leads to mate in exactly 2 moves
    // Returns true if: (1) side to move has a forced win in ≤2 moves
    //                  (2) opponent cannot escape or delay mate
    bool verify_mate_in_two(const Position3D& pos, Move3D& out_first_move, 
                           int time_limit_ms);
    
    // Extract the principal variation from search result
    std::string pv_to_string(const Position3D& pos, 
                            const std::vector<Move3D>& pv) const;
};

}  // namespace QuadLevel

#endif  // MATE_IN_2_GENERATOR_H_INCLUDED