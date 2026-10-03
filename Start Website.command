#!/bin/bash
# Oasis Preschool website - double-click to open it at http://localhost:8000
# Keep this window open while you use the site. Close it (or press Ctrl+C) to stop.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

PORT=8000
while lsof -ti tcp:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
URL="http://localhost:$PORT"

# Pick a web server that really works on this Mac.
# (Apple's /usr/bin/python3 is only a stub until the Command Line Tools are installed.)
SERVER=""
if command -v node >/dev/null 2>&1; then SERVER="node"
elif xcode-select -p >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then SERVER="python"
elif command -v perl >/dev/null 2>&1; then SERVER="perl"
fi

echo ""
echo "  Starting the Oasis Preschool website (using $SERVER)..."

case "$SERVER" in
  node)
    node -e '
      const http=require("http"),fs=require("fs"),path=require("path");
      const types={".html":"text/html; charset=utf-8",".css":"text/css",".js":"text/javascript",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".webp":"image/webp",".ico":"image/x-icon",".json":"application/json"};
      http.createServer((req,res)=>{
        let p=decodeURIComponent(req.url.split("?")[0]); if(p.endsWith("/")) p+="index.html";
        const f=path.join(process.cwd(),path.normalize(p).replace(/^(\.\.[\/\\])+/,""));
        fs.readFile(f,(e,d)=>{ if(e){res.writeHead(404);return res.end("Not found");}
          res.writeHead(200,{"Content-Type":types[path.extname(f).toLowerCase()]||"application/octet-stream"}); res.end(d); });
      }).listen(+process.argv[1],"127.0.0.1");' "$PORT" &
    ;;
  python)
    python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
    ;;
  perl)
    perl -MIO::Socket::INET -e '
      my %t=(html=>"text/html; charset=utf-8",css=>"text/css",js=>"text/javascript",png=>"image/png",jpg=>"image/jpeg",svg=>"image/svg+xml",webp=>"image/webp",json=>"application/json");
      my $s=IO::Socket::INET->new(LocalAddr=>"127.0.0.1",LocalPort=>$ARGV[0],Listen=>10,ReuseAddr=>1) or die "Cannot start: $!\n";
      while(my $c=$s->accept){ my $l=<$c>; while(my $h=<$c>){ last if $h=~/^\r?\n$/ }
        my ($p)=$l=~m{^\w+ (\S+)}; $p//="/"; $p=~s/\?.*//; $p=~s/%([0-9A-Fa-f]{2})/chr hex $1/ge; $p.="index.html" if $p=~m{/$}; $p=~s{\.\./}{}g; $p=~s{^/}{};
        if(open my $f,"<:raw",$p){ local $/; my $d=<$f>; my ($e)=$p=~/\.(\w+)$/;
          print $c "HTTP/1.0 200 OK\r\nContent-Type: ".($t{lc($e//"")}//"application/octet-stream")."\r\nContent-Length: ".length($d)."\r\nConnection: close\r\n\r\n".$d }
        else { print $c "HTTP/1.0 404 Not Found\r\nConnection: close\r\n\r\nNot found" }
        close $c }' "$PORT" &
    ;;
  *)
    echo "  No web server is available on this Mac, so the website is opening directly from the file instead."
    open "index.html"; echo ""; read -n 1 -s -r -p "Press any key to close."; exit 0
    ;;
esac
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

# Wait until the website is really answering before opening the browser.
OK=""
for _ in $(seq 1 30); do
  if curl -fsS --max-time 1 "$URL/" >/dev/null 2>&1; then OK=1; break; fi
  kill -0 $PID 2>/dev/null || break
  sleep 0.5
done

if [ -n "$OK" ]; then
  echo ""
  printf '\033[1;32m  The website is running at:  %s\033[0m\n' "$URL"
  echo "  Keep this window open. Close it to stop the website."
  echo ""
  open "$URL"
  wait $PID
else
  echo ""
  echo "  The local web server could not start, so the website is opening directly from the file instead."
  open "index.html"
fi
echo ""
read -n 1 -s -r -p "The website has stopped. Press any key to close."
